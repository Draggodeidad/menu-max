# ADR.md — Decisiones de arquitectura de MenusMax (backend)

Registro de decisiones del backend (`apps/api`, `packages/contracts`, `packages/database`). Cada ADR dice qué se decidió, por qué y qué se pierde con eso. Los agentes de IA deben tratar los ADR `Aceptado` como reglas obligatorias.

**Estados:** `Aceptado` (obligatorio) · `Propuesto` (pendiente de aprobación; no implementes lo que dependa de él sin confirmar) · `Reemplazado por ADR-NNN` · `Rechazado`.

**Cómo cambiar una decisión:** no se edita un ADR aceptado. Se escribe uno nuevo que lo reemplaza y se actualiza el estado del anterior.

## Índice

| ADR                                                                   | Decisión                                                 | Estado                       | Fecha      |
| --------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------- | ---------- |
| [001](#adr-001--monolito-modular-con-un-solo-worker-api)              | Monolito modular con un solo Worker API                  | Aceptado                     | 2026-11-11 |
| [002](#adr-002--api-privada-detrás-de-service-binding)                | API privada detrás de Service Binding                    | Aceptado                     | 2026-11-11 |
| [003](#adr-003--d1--drizzle-con-una-base-compartida)                  | D1 + Drizzle con una base compartida                     | Aceptado                     | 2026-11-11 |
| [004](#adr-004--zod-v4-como-contrato-único)                           | Zod v4 como contrato único                               | Aceptado                     | 2026-11-11 |
| [005](#adr-005--better-auth-solo-para-identidad)                      | Better Auth solo para identidad                          | Aceptado                     | 2026-11-11 |
| [006](#adr-006--multi-tenancy-por-organización-con-tenant-en-la-ruta) | Multi-tenancy por organización con tenant en la ruta     | Aceptado                     | 2026-11-11 |
| [007](#adr-007--autorización-rbac--abac-con-código-propio)            | Autorización RBAC + ABAC con código propio               | Aceptado                     | 2026-11-11 |
| [008](#adr-008--verificación-de-correo-no-bloqueante)                 | Verificación de correo no bloqueante                     | Aceptado (gracia: Propuesto) | 2026-11-11 |
| [009](#adr-009--correo-transaccional-con-cloudflare-email-service)    | Correo con Cloudflare Email Service tras puerto `Mailer` | Propuesto                    | 2026-11-11 |
| [010](#adr-010--anti-abuso-en-capas)                                  | Anti-abuso en capas                                      | Aceptado (login: Propuesto)  | 2026-11-11 |
| [011](#adr-011--una-cola-con-dlq-y-outbox-solo-para-pedidos)          | Una cola con DLQ; outbox solo para pedidos               | Aceptado                     | 2026-11-11 |
| [012](#adr-012--documentación-openapi-solo-en-desarrollo)             | Documentación OpenAPI solo en desarrollo                 | Aceptado                     | 2026-11-11 |
| [013](#adr-013--ids-uuidv7-y-tokens-públicos-hasheados)               | Ids UUIDv7 y tokens públicos hasheados                   | Aceptado                     | 2026-11-11 |
| [014](#adr-014--caché-del-menú-público-en-web-con-versión)            | Caché del menú público en WEB con versión                | Aceptado (TTL: Propuesto)    | 2026-11-11 |
| [015](#adr-015--retención-de-datos-del-comensal)                      | Retención de datos del comensal                          | Propuesto                    | 2026-11-11 |
| [016](#adr-016--modelo-de-datos-reducido-para-el-mvp)                 | Modelo de datos reducido para el MVP                     | Aceptado                     | 2026-11-11 |

---

## ADR-001 — Monolito modular con un solo Worker API

**Estado:** Aceptado · **Fecha:** 2026-11-11

**Contexto.** El producto tiene varios dominios (auth, catálogo, pedidos, notificaciones) pero un equipo pequeño y un MVP. Microservicios multiplicarían despliegues, contratos internos y puntos de falla.

**Decisión.** Un único Worker Hono (`apps/api`) con módulos internos. El mismo Worker expone `fetch` (HTTP), `queue` (consumidor) y `scheduled` (Cron). Cada módulo tiene `routes`, `service` y `repository`; no hay capa de `controller`.

**Consecuencias.**

- Un solo despliegue y un solo lugar para reglas de negocio y persistencia.
- Los módulos se comunican llamando servicios, no repositorios ajenos.
- Crear un segundo Worker de backend requiere un ADR nuevo.

**Alternativas descartadas.** Un Worker por dominio; NestJS (no está pensado para Workers).

---

## ADR-002 — API privada detrás de Service Binding

**Estado:** Aceptado · **Fecha:** 2026-11-11

**Contexto.** El navegador solo habla con SvelteKit (BFF). Exponer la API agrega CORS, superficie de ataque y la posibilidad de falsear headers como la IP del cliente.

**Decisión.**

- `apps/api` sin ruta pública: `workers_dev: false`, sin `routes` ni dominio propio. Solo `apps/web` la llama por Service Binding (`env.API.fetch`).
- Defensa en profundidad: header `x-mm-internal` con el secreto `INTERNAL_TOKEN`, comparado en tiempo constante en cada petición.
- WEB reenvía `x-request-id`, `x-client-ip` (de `CF-Connecting-IP`), `user-agent`, `origin` y el header `cookie`; devuelve al navegador los `set-cookie` de la API.
- La cookie de sesión vive en el dominio de WEB (`httpOnly`, `secure`, `sameSite=lax`).

**Consecuencias.**

- La API confía en `x-client-ip` solo porque es privada; si alguna vez se publica, esa confianza se rompe y hay que revisar este ADR.
- Una app móvil futura requerirá una ruta pública con tokens bearer y un ADR propio.

**Alternativas descartadas.** API pública con CORS; firmar cada petición con HMAC (costo sin beneficio mientras la API sea privada).

---

## ADR-003 — D1 + Drizzle con una base compartida

**Estado:** Aceptado · **Fecha:** 2026-11-11

**Contexto.** Necesitamos SQL relacional, migraciones y tipado dentro de Cloudflare. D1 es SQLite administrado: hasta 10 GB por base en Workers Paid, sin transacciones interactivas y con una instancia primaria de escritura por base.

**Decisión.**

- Una sola base D1 por entorno (dev, staging, producción), compartida por todos los tenants.
- Drizzle ORM (`drizzle-orm/d1`); esquema y migraciones en `packages/database`.
- Atomicidad con `db.batch([...])`. **Prohibido `db.transaction()`.**
- Concurrencia optimista con columna `version`.
- Migraciones con `drizzle-kit generate` y `wrangler d1 migrations apply`; producción solo desde CI; cambios destructivos en _expand/contract_.
- Respaldo con Time Travel de D1 (30 días en Workers Paid); restauración probada antes del piloto.

**Consecuencias.**

- Los servicios calculan todo antes de escribir y escriben en un solo batch.
- Los repositorios reciben `db` como argumento, para poder mover un tenant grande a su propia base sin tocar los dominios.
- Umbral para revisar este ADR: una organización con más de ~1 GB o más de 30 % de las escrituras.

**Alternativas descartadas.** Postgres vía Hyperdrive (más infraestructura que operar); una D1 por tenant desde el inicio (migraciones N veces).

---

## ADR-004 — Zod v4 como contrato único

**Estado:** Aceptado · **Fecha:** 2026-11-11

**Contexto.** El frontend valida formularios, la API valida entrada y la documentación necesita esquemas. Mantener tres definiciones de lo mismo genera desalineaciones.

**Decisión.**

- Todos los esquemas de entrada, DTOs de salida, enums, códigos de error y mensajes de cola viven en `packages/contracts` con Zod v4.
- Entrada con `z.strictObject` (llaves desconocidas = `400`). Strings con `trim` y longitud máxima; correos en minúsculas; teléfonos en E.164; dinero en centavos enteros.
- Las respuestas pasan por mappers a DTO; nunca se devuelve una fila de la base.
- Las variables de entorno se validan con Zod en `apps/api/src/env.ts`.
- Formato de error único: `{ code, message, requestId, fieldErrors? }` con el catálogo de `contracts/errors.ts`.

**Consecuencias.**

- Cambiar un esquema afecta a web y api a la vez; los cambios incompatibles se detectan con el diff de OpenAPI en CI.
- `packages/contracts` no puede importar nada de Workers, Hono ni Drizzle.

**Alternativas descartadas.** Valibot; esquemas separados por app.

---

## ADR-005 — Better Auth solo para identidad

**Estado:** Aceptado · **Fecha:** 2026-11-11 · Cierra la decisión pendiente "Autenticación" del README §20.

**Contexto.** Escribir hashing, tokens de verificación, reset y sesiones a mano agrega superficie de error. Better Auth funciona en Workers con Drizzle sobre D1.

**Decisión.**

- Better Auth en `modules/auth`, montado en `/v1/auth/*`, instanciado por petición con `createAuth(env)`.
- Habilitado: email + contraseña, verificación de correo, reset de contraseña, sesiones en D1 (7 días, renovación diaria), plugin `haveIBeenPwned`.
- Contraseña de 10 a 128 caracteres. Al cambiar o restablecer contraseña se revocan las demás sesiones.
- `requireEmailVerification: false`; la regla vive en nuestras políticas (ADR-008).
- `sendVerificationEmail` y `sendResetPassword` encolan `email.send` (ADR-011).
- `trustedOrigins` = origen de WEB.
- **No** se usa el plugin `organization` de Better Auth: tenancy y permisos son nuestros (ADR-006, ADR-007).
- Versión fijada exacta; se revisa su changelog antes de actualizar.

**Consecuencias.**

- Las tablas de identidad (`users`, `sessions`, `accounts`, `verifications`) se generan con su CLI hacia `packages/database/src/schema/auth.ts`.
- Los demás módulos solo leen `c.var.user`; cambiar de proveedor afecta únicamente a `modules/auth`.

**Alternativas descartadas.** Auth propio; Lucia (ya no se mantiene como librería); plugin `organization` (duplicaría la fuente de verdad de membresías).

---

## ADR-006 — Multi-tenancy por organización con tenant en la ruta

**Estado:** Aceptado · **Fecha:** 2026-11-11 · Reemplaza el borrador de rutas del README §13.

**Contexto.** El aislamiento entre negocios es el riesgo técnico principal de una base compartida.

**Decisión.**

- `organization` es el tenant; `business` la marca; `branch` la ubicación. Un usuario puede tener varias membresías.
- Las rutas privadas llevan el tenant explícito: `/v1/orgs/:orgId/...` y, si aplica, `/v1/orgs/:orgId/branches/:branchId/...`.
- `requireMembership` carga la membresía activa `(orgId, userId)` y construye `TenantContext = { orgId, memberId, role, branchIds, plan }`. Sin membresía → `404`.
- Toda función de repositorio de tenant recibe `tenant` y filtra `organization_id = tenant.orgId`.
- Recurso de otro tenant → `404 NOT_FOUND`, nunca `403`.
- Rutas públicas (`/v1/public/*`) se resuelven por `slug` o token y usan consultas dedicadas que solo leen columnas publicables.
- `eslint-plugin-drizzle` con `enforce-update-with-where` y `enforce-delete-with-where`.

**Consecuencias.**

- Cada ruta privada necesita pruebas de aislamiento (otra organización → 404).
- Índices compuestos empiezan por `organization_id`.

**Alternativas descartadas.** Organización activa guardada en la sesión (estado implícito, fácil de confundir entre pestañas); una base por tenant.

---

## ADR-007 — Autorización RBAC + ABAC con código propio

**Estado:** Aceptado · **Fecha:** 2026-11-11

**Contexto.** Los roles no bastan: `staff` solo debe operar sus sucursales, las transiciones dependen del estado del pedido y los límites del plan dependen del uso.

**Decisión.**

- **RBAC** en `shared/authz/permissions.ts`: mapa rol → permisos (`orders:read`, `orders:transition`, `orders:cancel`, `catalog:write`, `catalog:availability`, `storefront:publish`, `settings:write`, `branches:manage`, `members:manage`, `subscription:read`, `organization:delete`). Se aplica con `requirePermission()` en la ruta, sin tocar la base.
- **ABAC** en `shared/authz/policies.ts`: funciones puras que reciben vistas mínimas del recurso y devuelven `allow()` / `deny(code)`. Se aplican en el servicio con el recurso cargado, antes de escribir.
- Atributos del MVP: `actor.emailVerified`, `tenant.branchIds`, `resource.orgId/branchId`, `resource.status`, `resource.version`, `target.role`, `org.plan` y uso, `branch.isOpen(now)`.
- Reglas fijas: `admin` no modifica a un `owner`; nunca se elimina al último `owner`; `admin` solo gestiona `staff`.
- Las consultas de lista aplican el mismo filtro que la política, en SQL.

**Matriz RBAC del MVP**

| Permiso                                                   | owner | admin        | staff               |
| --------------------------------------------------------- | ----- | ------------ | ------------------- |
| `orders:read`, `orders:transition`                        | Sí    | Sí           | Solo sus sucursales |
| `orders:cancel`                                           | Sí    | Sí           | No                  |
| `catalog:write`                                           | Sí    | Sí           | No                  |
| `catalog:availability`                                    | Sí    | Sí           | Sí                  |
| `storefront:publish`, `settings:write`, `branches:manage` | Sí    | Sí           | No                  |
| `members:manage`                                          | Sí    | Solo `staff` | No                  |
| `subscription:read`, `organization:delete`                | Sí    | No           | No                  |

**Consecuencias.**

- Una prueba recorre todas las rutas registradas y falla si una privada no tiene guarda.
- Roles personalizados por negocio quedan fuera del MVP; la tabla permite agregarlos sin tocar políticas.

**Alternativas descartadas.** CASL, Casbin u Oso (más abstracción que reglas); RBAC solo.

---

## ADR-008 — Verificación de correo no bloqueante

**Estado:** Aceptado · Período de gracia: **Propuesto** · **Fecha:** 2026-11-11

**Contexto.** DESIGN.md pide "valor antes que cuenta": el dueño publica sin fricción. Pero un bot que crea cuentas no debe obtener un menú que recibe pedidos ni enviar WhatsApp. La única prueba de que un correo existe es que su dueño haga clic en un enlace.

**Decisión.**

| Estado                                    | Puede                                         | No puede                                                          |
| ----------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- |
| Sin verificar                             | Entrar, editar menú, ver QR, pedido de prueba | Recibir pedidos de comensales, activar WhatsApp, invitar miembros |
| Verificada                                | Todo según su rol                             | —                                                                 |
| Sin verificar vencida (Propuesto: 7 días) | Entrar y pedir reenvío                        | Su menú público muestra "Este menú aún no está activo"            |
| Suspendida                                | Nada; sesiones revocadas                      | —                                                                 |

- El enlace de verificación vence en 24 h. Reenvío: 1 cada 60 s y 5 por día por cuenta.
- Filtros antes de crear la cuenta: sintaxis Zod, dominios desechables (lista estática actualizada por script) y MX vía DNS-over-HTTPS (`cloudflare-dns.com`), resultado guardado 24 h en `email_domain_checks`.
- No se hace sondeo SMTP.
- Rebote duro o queja reportados por el proveedor → `users.email_status = 'undeliverable'` y no se vuelve a enviar.
- Sin enumeración: reset y reenvío responden siempre lo mismo; registrarse con un correo existente envía un aviso a ese correo.

**Consecuencias.**

- `requireVerifiedEmail` en rutas de publicación para comensales, WhatsApp e invitaciones.
- El onboarding (`POST /v1/onboarding`) crea usuario con Better Auth y luego un `db.batch` con organización, membresía `owner`, negocio, sucursal, menú y productos. Si el batch falla, `/app` reanuda con la misma clave de idempotencia.

**Pendiente.** Confirmar los días de gracia (3, 7 o 14).

---

## ADR-009 — Correo transaccional con Cloudflare Email Service

**Estado:** Propuesto · **Fecha:** 2026-11-11

**Contexto.** Necesitamos enviar verificación, reset e invitaciones. Cloudflare Email Service permite enviar desde un Worker con el binding `send_email` sin API keys, pero está en **beta**, requiere Workers Paid y onboarding del dominio emisor. Aún no está claro cómo reporta rebotes.

**Decisión propuesta.**

- Puerto `Mailer` con una sola función: `send({ to, template, data })`.
- Adaptador principal: Cloudflare Email Service (`env.EMAIL.send()`).
- Adaptador de desarrollo: escribe en consola y en `.wrangler/emails/`.
- Adaptador de respaldo listo para Resend o Amazon SES si la beta limita.
- Remitente `no-responder@<dominio>` con SPF, DKIM y DMARC; texto plano + HTML simple; sin tracking de aperturas.
- Plantillas en código, en español de México.

**Para aceptarlo.** Prueba de entregabilidad a Gmail, Outlook y Yahoo, y confirmar cómo se obtienen rebotes y quejas.

---

## ADR-010 — Anti-abuso en capas

**Estado:** Aceptado · Turnstile en login: **Propuesto** · **Fecha:** 2026-11-11

**Contexto.** El binding `ratelimits` de Workers cuenta por ubicación de Cloudflare y solo admite ventanas de 10 o 60 s: sirve como filtro grueso, no como cuota exacta.

**Decisión.**

| Capa                    | Dónde                                                            | Uso                                                 |
| ----------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| WAF rate limiting rules | Zona de WEB                                                      | Cortar ráfagas antes de ejecutar Workers            |
| Turnstile               | Registro, reset, pedido público; login tras 3 fallos (Propuesto) | Validado en la API con `siteverify`, de un solo uso |
| Binding `ratelimits`    | API, llave `ip + grupo de rutas`                                 | Filtro grueso                                       |
| Cuotas exactas en D1    | Tabla `rate_counters` con upsert atómico                         | Reglas de negocio                                   |
| Honeypot                | Formularios públicos                                             | Bots simples                                        |

**Cuotas exactas**

| Acción                 | Límite                       | Llave               |
| ---------------------- | ---------------------------- | ------------------- |
| Crear cuenta           | 3 por día                    | IP                  |
| Reenviar verificación  | 1 cada 60 s, 5 por día       | Usuario             |
| Restablecer contraseña | 3 por hora                   | Correo normalizado  |
| Login fallido          | 5 en 15 min, luego Turnstile | Correo + IP         |
| Pedido público         | 3 en 10 min                  | Teléfono + sucursal |
| Pedido público         | 30 por hora                  | IP                  |
| Invitaciones           | 20 por día                   | Organización        |

- Pedido: máximo 50 líneas, 99 unidades por línea; sucursal abierta, modalidad activa y zona atendida.
- `rate_counters` se limpia con un Cron diario.

**Alternativas descartadas.** Durable Objects para rate limit exacto (posterior, si D1 no alcanza).

---

## ADR-011 — Una cola con DLQ y outbox solo para pedidos

**Estado:** Aceptado · **Fecha:** 2026-11-11 · Precisa el README §11.

**Decisión.**

- Una cola `jobs` y una DLQ `jobs-dlq`. Mensajes como unión discriminada de Zod en `contracts`.
- `email.send` se encola directo desde la petición: si se pierde, el usuario pide reenvío.
- `notification.whatsapp` usa **transactional outbox**: se inserta en el mismo `db.batch` que el pedido; un relay por Cron cada minuto publica pendientes con más de 30 s; la petición intenta publicar antes con `waitUntil`.
- Consumidor idempotente con `notification_deliveries.dedupe_key` único (`orderId:event:recipient`).
- Timeout de 10 s a proveedores. Transitorio → reintento con backoff; permanente → se registra y se confirma; `max_retries: 5` → DLQ.
- Timeout después de que el proveedor aceptó → estado `ambiguous`, sin reintento automático.
- Mensaje inválido según Zod → DLQ sin reintento.

**Alternativas descartadas.** Una cola por tipo de mensaje; outbox para todo.

---

## ADR-012 — Documentación OpenAPI solo en desarrollo

**Estado:** Aceptado · **Fecha:** 2026-11-11

**Decisión.**

- `hono-openapi` genera el documento desde los esquemas Zod v4; `@scalar/hono-api-reference` lo muestra.
- `GET /docs` y `GET /openapi.json` se registran **solo** cuando `ENVIRONMENT === 'development'`, dentro de `registerDocs()`. En staging y producción no existen.
- En local se abren en `http://localhost:8787/docs`. `registerDocs` las monta antes del middleware interno (ADR-002), porque el navegador no envía `x-mm-internal`; es la única excepción y solo existe en development.
- El plugin `openAPI` de Better Auth también solo en desarrollo.
- `pnpm --filter api openapi:export` escribe `docs/api/openapi.json`; CI compara contra `main` y falla ante cambios incompatibles sin la etiqueta `breaking-change`.
- Una prueba confirma `404` en `/docs` y `/openapi.json` con `ENVIRONMENT=production`.

**Alternativas descartadas.** `@hono/zod-openapi` (obliga a reescribir cada ruta con `createRoute`); docs públicas protegidas con contraseña.

---

## ADR-013 — Ids UUIDv7 y tokens públicos hasheados

**Estado:** Aceptado · **Fecha:** 2026-11-11

**Decisión.**

- Ids de todas las tablas: UUIDv7 en `text` (ordenables, buen índice, no enumerables).
- Número visible de pedido (`#1042`): contador por sucursal; nunca se usa para consultar.
- Tokens públicos (seguimiento de pedido, invitaciones): 32 bytes de `crypto.getRandomValues` en base64url; en la base solo su SHA-256; comparación en tiempo constante.
- Idempotencia: tabla `idempotency_keys (key, org_id, request_hash, response, expires_at)`; misma llave y mismo cuerpo devuelve la misma respuesta; otro cuerpo → `409 IDEMPOTENCY_CONFLICT`; expiración 24 h.

---

## ADR-014 — Caché del menú público en WEB con versión

**Estado:** Aceptado · TTL: **Propuesto** · **Fecha:** 2026-11-11

**Contexto.** El menú público es la ruta con más tráfico. La Cache API necesita un Worker con zona, y la API no tiene ruta pública (ADR-002).

**Decisión.**

- La caché vive en WEB, con llave `menu:{slug}:v{menuVersion}`.
- La API expone `menuVersion`; publicar o editar el catálogo lo incrementa, así que no hay purga manual.
- Nunca se cachean `/app/*`, checkout, `/pedido/[token]` ni respuestas con datos personales.
- Al confirmar un pedido, los precios se leen siempre de D1, nunca de caché.

**Pendiente.** TTL propuesto: 300 s (la versión en la llave invalida al publicar).

---

## ADR-015 — Retención de datos del comensal

**Estado:** Propuesto · **Fecha:** 2026-11-11

**Decisión propuesta.**

- Nombre, teléfono y dirección del comensal solo se guardan dentro del pedido.
- A los 12 meses, un Cron anonimiza esos campos y conserva importes, productos y fechas para estadísticas.
- `customer_phone_hash` (SHA-256 con sal del entorno) permite cuotas y bloqueos sin guardar el teléfono en claro fuera del pedido.
- Logs sin PII desde el día uno (`redact()`).

**Pendiente.** Elegir 6, 12 o 24 meses y revisar el aviso de privacidad.

---

## ADR-016 — Modelo de datos reducido para el MVP

**Estado:** Aceptado · **Fecha:** 2026-11-11 · Simplifica la tabla del README §9.

**Decisión.** Un menú por sucursal; productos que cuelgan directo de su categoría; sin `menu_products`, `order_item_options` separado ni `notification_preferences` en el MVP.

| Dominio                 | Tablas                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Identidad (Better Auth) | `users` (+ `email_status`), `sessions`, `accounts`, `verifications`                                                   |
| Tenancy                 | `organizations`, `organization_members`, `member_branches`, `invitations`                                             |
| Negocio                 | `businesses`, `branches` (modalidades como booleanos, `timezone`), `business_hours`, `delivery_zones`                 |
| Catálogo                | `menus`, `categories`, `products`, `product_variants`, `option_groups`, `options`                                     |
| Storefront              | `storefront_themes`                                                                                                   |
| Media                   | `media_assets`                                                                                                        |
| Pedidos                 | `orders`, `order_items` (snapshot de nombre, variante, opciones y precio), `order_status_history`, `idempotency_keys` |
| Mensajería              | `notification_outbox`, `notification_deliveries`                                                                      |
| Planes                  | `plans`, `subscriptions`                                                                                              |
| Operación               | `audit_logs`, `rate_counters`, `email_domain_checks`                                                                  |

**Consecuencias.** Compartir productos entre menús o sucursales requerirá un ADR y una migración _expand/contract_ cuando un negocio real lo pida.

---

## Plantilla para un ADR nuevo

```markdown
## ADR-NNN — Título en una línea

**Estado:** Propuesto · **Fecha:** AAAA-MM-DD · (Reemplaza ADR-XXX, si aplica)

**Contexto.** Qué problema hay y qué restricciones importan.

**Decisión.** Qué se hace, en reglas verificables.

**Consecuencias.** Qué cambia, qué se vuelve obligatorio y qué se pierde.

**Alternativas descartadas.** Opción y por qué no.
```
