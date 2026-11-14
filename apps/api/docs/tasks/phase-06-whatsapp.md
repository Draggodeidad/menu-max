# Fase B6 — WhatsApp

> Planeación del backend (versionada en git).
> **Criterio para cerrar la fase:** si WhatsApp falla, el pedido sigue visible en el panel y el aviso se reintenta o queda en DLQ; nunca se pierde en silencio.
> **Orden de ejecución:** T24 → T25.
> **Prerrequisitos humanos:** cuenta de WhatsApp Business Platform, número emisor, plantillas aprobadas por Meta (`es_MX`) y secretos cargados por entorno. Sin eso, las pruebas usan Meta simulado y no se prueba contra Meta real.

---

## T24 — Relay del outbox y consumidor de WhatsApp

**Fase:** B6 · **Depende de:** T08, T21, T23 · **ADR:** 011 · **Rama sugerida:** `feat/t24-whatsapp`

### Objetivo

Cada evento de pedido llega a la cola aunque la petición original falle después de guardar, y cada destinatario recibe a lo más un aviso por evento.

### Alcance

- **Relay:**
  - tras crear un pedido o una transición, `c.executionCtx.waitUntil(publishPending(orderId))` intenta publicar su evento;
  - Cron cada minuto (`* * * * *`): toma hasta 100 filas `pending` con más de 30 s, las publica con `JOBS.sendBatch` y las marca `published` con `update … where status = 'pending'`;
  - publicar dos veces es aceptable (el consumidor deduplica).
- `JobMessage` agrega `notification.whatsapp = { type, outboxId, event: 'order.created' | 'order.status_changed', orderId, organizationId }`.
- Tabla `notification_deliveries (id, organization_id, dedupe_key unique, order_id, channel, recipient_hash, template, template_version, status check in ('sending','sent','delivered','read','failed','ambiguous','dead'), external_id, attempts, last_error, created_at, updated_at)`.
- **Destinatarios:**
  - `order.created` → `branches.alert_whatsapp` si tiene `alert_opt_in_at` y algún `owner` tiene correo verificado;
  - `order.status_changed` → el comensal solo si `customer_whatsapp_opt_in` y existe plantilla aprobada para ese estado (configurable por variable); si no, no se envía nada.
- **Consumidor** (`jobs/whatsapp.handler.ts`):
  1. `insert … on conflict(dedupe_key) do nothing` con `dedupe_key = orderId:event:status:recipientHash`; si ya existe en `sent`, `delivered`, `read` o `ambiguous` → `ack`;
  2. `infrastructure/whatsapp.ts`: `POST https://graph.facebook.com/${META_GRAPH_API_VERSION}/${META_PHONE_NUMBER_ID}/messages` con plantilla y parámetros (número de pedido, sucursal, modalidad, total, resumen de ítems, colonia para domicilio, enlace `${WEB_ORIGIN}/app`); timeout de 10 s;
  3. 2xx → `sent` + `external_id`;
  4. 429, 5xx o error de red **antes** de recibir respuesta → `retry` con backoff;
  5. timeout sin saber si Meta aceptó → `ambiguous`, `ack`, `log.warn` (sin reintento automático);
  6. 4xx de número o plantilla → `failed`, `ack`.
- **DLQ:** consumidor de `menusmax-jobs-dlq` que marca `dead` en `notification_deliveries` (si aplica) y hace `log.error` con `requestId` y `outboxId`. `docs/runbooks/reprocesar-dlq.md` explica cómo reencolar a mano.
- El mensaje nunca incluye tokens de sesión ni la dirección completa; el enlace al panel exige iniciar sesión.

### Fuera de alcance

- Webhook de estados de Meta (T25).
- Que cada negocio conecte su propio número (README §19).

### Variables de entorno y bindings

- `META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID`, `META_GRAPH_API_VERSION`, `META_TEMPLATE_NEW_ORDER`, `META_TEMPLATE_LANG` (`es_MX`), y opcionales por estado para el comensal. Cron `* * * * *`. Agregar a `env.ts`, `.dev.vars.example` y `.env.example`.

### Pruebas requeridas

- [ ] Pedido creado y petición "cortada" antes del `waitUntil` → el Cron publica el evento.
- [ ] Mismo mensaje entregado dos veces por la cola → un solo envío a Meta.
- [ ] 500 de Meta → reintento; 400 de plantilla → `failed` sin reintento; timeout → `ambiguous` sin reintento.
- [ ] Cinco fallos transitorios → DLQ → `dead`.
- [ ] Owner sin verificar o sucursal sin opt-in → no se envía nada y queda registrado.
- [ ] El cuerpo enviado a Meta no contiene calle ni número de la dirección.
- [ ] El panel muestra el pedido aunque Meta esté caído.

### Criterios de aceptación

- [ ] `notification_outbox` no conserva eventos `pending` de más de 2 minutos con la cola sana.

---

## T25 — Webhook de estados de Meta

**Fase:** B6 · **Depende de:** T24 · **ADR:** 011, 019 (Propuesto) · **Rama sugerida:** `feat/t25-webhook-meta`

> Depende de ADR-019 (`Propuesto`): Meta necesita una URL pública y la API es privada (ADR-002). No empieces hasta que esté aceptado. Esta task toca `apps/web`: lee también `apps/web/AGENTS.md`.

### Objetivo

Los estados de entrega que reporta Meta (enviado, entregado, leído, fallido) actualizan `notification_deliveries` sin aceptar llamadas falsas, repetidas o fuera de orden.

### Alcance

- **WEB:** `src/routes/webhooks/meta/+server.ts`:
  - `GET` y `POST` reenvían a la API por Service Binding (`/v1/webhooks/meta`) el **cuerpo crudo**, la query y el header `x-hub-signature-256`, sin parsear;
  - sin sesión, sin caché, sin lógica.
- **API:** `modules/notifications/webhook.routes.ts`:
  - `GET /v1/webhooks/meta`: si `hub.mode = subscribe` y `hub.verify_token = META_WEBHOOK_VERIFY_TOKEN` → responde `hub.challenge`; si no → 403;
  - `POST /v1/webhooks/meta`: HMAC-SHA256 del cuerpo crudo con `META_APP_SECRET`, comparación en tiempo constante; firma inválida → 401 sin procesar;
  - procesa `statuses[]`: busca por `external_id`; solo avanza el estado (`sent < delivered < read`; `failed` desde cualquiera anterior); repetidos y atrasados se ignoran;
  - responde 200 rápido; nada pesado antes de responder.
- Límite de cuerpo de 256 KB en esta ruta.

### Fuera de alcance

- Mensajes entrantes de clientes (no se procesan en el MVP; se ignoran con 200).

### Variables de entorno y bindings

- `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`. Agregar a `env.ts`, `.dev.vars.example` y `.env.example`.

### Pruebas requeridas

- [ ] Verificación `GET` con token correcto devuelve el `challenge`; incorrecto → 403.
- [ ] Firma inválida o ausente → 401 y ningún cambio.
- [ ] `delivered` después de `read` no retrocede el estado.
- [ ] El mismo webhook dos veces → mismo resultado.
- [ ] La ruta de WEB entrega el cuerpo byte a byte (prueba con un cuerpo con acentos y espacios).

### Criterios de aceptación

- [ ] Ningún log contiene el cuerpo del webhook ni números de teléfono.
