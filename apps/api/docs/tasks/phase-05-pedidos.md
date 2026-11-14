# Fase B5 — Pedidos

> Planeación local (en `.gitignore`).
> **Criterio para cerrar la fase:** un pedido se registra una sola vez ante reintentos y su total no cambia por manipulación; el panel lo opera de principio a fin.
> **Orden de ejecución:** T21 → T23, en orden numérico.

---

## T21 — Crear pedido público (`POST /v1/public/orders`)

**Fase:** B5 · **Depende de:** T18, T20 · **ADR:** 010, 011, 013 · **Rama sugerida:** `feat/t21-crear-pedido`

### Objetivo

Un comensal envía un pedido como invitado y la API lo registra una sola vez, con el total que ella calcula y su evento de aviso listo para WhatsApp.

### Alcance

- Tablas y migración:
  - `orders (id, organization_id, branch_id, menu_id, number, status, mode check in ('table','pickup','delivery'), table_number, customer_name, customer_phone, customer_phone_hash, customer_whatsapp_opt_in, delivery_street, delivery_number, delivery_neighborhood, delivery_city, delivery_postal_code, delivery_references, delivery_zone_id, subtotal_cents, delivery_fee_cents, total_cents, currency, payment_method check in ('cash'), notes, is_test, tracking_token_hash unique, version, created_at, updated_at)`; índices `(organization_id, branch_id, status, updated_at)` y `(branch_id, customer_phone_hash, created_at)`;
  - `order_items (id, organization_id, order_id, product_id, product_name, variant_name, options_snapshot text (JSON), unit_price_cents, quantity, line_total_cents, notes)`;
  - `order_status_history (id, organization_id, order_id, from_status, to_status, actor_member_id, reason, created_at)`;
  - `notification_outbox (id, organization_id, event, payload_json, status check in ('pending','published'), created_at, published_at)`.
- `OrderInput` (estricto): `{ menuSlug, mode, tableNumber?, items: [{ productId, variantId?, optionIds: [], quantity, notes? }] (1…50), customer: { name, phone, whatsappOptIn }, delivery?: { street, number, neighborhood, city, postalCode, references? }, notes? }`; header `Idempotency-Key` (UUID) y `x-turnstile-token`.
- `modules/orders/pricing.ts` (puro): recibe el catálogo vigente y los ítems; valida existencia, disponibilidad, variante y opciones del mismo producto, `min_select`/`max_select`, 1–99 unidades; devuelve líneas con snapshot y totales en centavos. Errores por ítem en `fieldErrors` (`items.2.productId`: "Este producto ya no está disponible. Quítalo para continuar.").
- Flujo del servicio, en este orden:
  1. Turnstile; cuotas: 30 por hora por IP y 3 cada 10 min por `customer_phone_hash + branch`.
  2. Menú por slug, publicado.
  3. `acceptingOrders` (T18). Excepción: si la petición trae sesión de un miembro de esa organización, el pedido se acepta como `is_test = 1` aunque la cuenta no esté verificada (pedido de prueba de `/app/listo`).
  4. Modalidad activa; mesa en `1…table_count` para `table`; para `delivery`, dirección completa y zona activa por código postal (`BUSINESS_RULE` "No entregamos en ese código postal." si no hay).
  5. `pricing` con el catálogo leído en un `batch`; total ≤ `max_order_total_cents` si existe.
  6. Idempotencia con `shared/idempotency.ts` (T20): misma llave y cuerpo → respuesta guardada; otro cuerpo → `IDEMPOTENCY_CONFLICT`.
  7. Un solo `db.batch`: `orders` (número con subconsulta a `branches.next_order_number`), `branches.next_order_number + 1`, `order_items`, `order_status_history` (`null → pending`), `notification_outbox` (`order.created`) salvo pedidos de prueba con cuenta sin verificar, `idempotency_keys`.
  8. `201 { number, status, totalCents, trackingToken }`. El token en claro solo se devuelve aquí.
- `customer_phone_hash` = SHA-256 de `PHONE_HASH_SALT + teléfono E.164`.

### Fuera de alcance

- Publicar el outbox a la cola (T24); seguimiento (T22); operación del panel (T23).
- Pagos en línea; cupones; propinas.

### Variables de entorno y bindings

- `PHONE_HASH_SALT` (secreto). Agregar a `env.ts`, `.dev.vars.example` y `.env.example`.

### Pruebas requeridas

- [ ] Caso feliz por cada modalidad; el total coincide con el cálculo esperado.
- [ ] Un `price` o `total` en el body → `VALIDATION_FAILED` (objeto estricto).
- [ ] Producto no disponible, borrado, de otro menú o variante de otro producto → error en el ítem correcto.
- [ ] Mismo `Idempotency-Key` y cuerpo → un solo pedido; otro cuerpo → 409.
- [ ] Sucursal cerrada, modalidad apagada, mesa fuera de rango, CP sin zona → 422 con mensaje accionable.
- [ ] Cuenta sin verificar → rechazo para comensal; pedido de prueba con sesión de miembro → aceptado con `is_test`.
- [ ] Cuarto pedido en 10 min del mismo teléfono en la misma sucursal → 429.
- [ ] Pedido y outbox se escriben juntos o no se escribe nada (falla simulada a mitad).
- [ ] Números consecutivos por sucursal bajo pedidos concurrentes (sin duplicados).
- [ ] La base solo guarda el hash del token.

### Criterios de aceptación

- [ ] Ninguna lectura de caché interviene en el cálculo del total.
- [ ] `PublicMenuDto` y `OrderInput` comparten ids y enums desde `contracts`.

---

## T22 — Seguimiento público del pedido

**Fase:** B5 · **Depende de:** T21 · **ADR:** 013 · **Rama sugerida:** `feat/t22-seguimiento`

### Objetivo

El comensal consulta el estado de su pedido con el enlace no adivinable que recibió, sin exponer datos de otros pedidos ni datos sensibles del suyo.

### Alcance

- `GET /v1/public/orders/:token` (rate limit `public`):
  - busca por `sha256(token)`; inexistente → 404;
  - `PublicOrderDto`: `number`, `status`, `mode`, `tableNumber`, ítems (nombre, variante, cantidad), `totalCents`, `createdAt`, historial `[{ status, at }]`, nombre del negocio y sucursal, `contactPhone`, `isFinal`;
  - **no** incluye teléfono del cliente ni dirección completa (solo colonia para domicilio);
  - `ETag` por `version`; `If-None-Match` igual → `304`; `Cache-Control: no-store`.
- Constante `FINAL_STATUSES` en `contracts` para que WEB detenga el polling.

### Fuera de alcance

- Cancelación por parte del comensal.

### Pruebas requeridas

- [ ] Token válido → DTO correcto; token inválido o de longitud incorrecta → 404 sin diferencia de tiempo apreciable.
- [ ] El DTO no contiene `customerPhone`, calle ni número (prueba con esquema estricto).
- [ ] `ETag` sin cambios → 304; tras una transición → 200 con nuevo `ETag`.

---

## T23 — Panel de pedidos y máquina de estados

**Fase:** B5 · **Depende de:** T21 · **ADR:** 007 · **Rama sugerida:** `feat/t23-panel-pedidos`

### Objetivo

El personal ve los pedidos de sus sucursales casi en tiempo real y los avanza un estado a la vez, sin pisarse entre dos personas.

### Alcance

- `packages/contracts/src/orders.ts`:
  - `ORDER_TRANSITIONS`:
    - `pending → accepted | rejected`;
    - `accepted → preparing | cancelled`;
    - `preparing → ready | cancelled`;
    - `ready → completed` (mesa y recoger) o `ready → out_for_delivery` (domicilio);
    - `out_for_delivery → delivered`;
  - `FINAL_STATUSES = ['completed','delivered','rejected','cancelled']`.
- Política `canTransitionOrder(tenant, order, to)` en `policies.ts` (ADR-007): pertenencia, sucursal de `staff`, transición válida para la modalidad, `cancelled` solo con `orders:cancel`.
- Rutas bajo `/branches/:branchId/orders`:
  - `GET /` (`orders:read`) con `status=active|done`, `since` (ms) y `cursor`; `ETag` del listado (máximo `updated_at` + conteo); sin cambios → `304`;
  - `GET /:orderId` (`orders:read`) → detalle con teléfono y dirección completos (solo para miembros);
  - `POST /:orderId/transitions` (`orders:transition`) → `{ to, version, reason? }`; `reason` obligatorio para `rejected` y `cancelled` (≤ 280 caracteres).
- Transición en un `batch`: `update … where id and organization_id and version` + historial + outbox `order.status_changed` si `customer_whatsapp_opt_in`. Cero filas → `CONFLICT` ("Otra persona ya actualizó este pedido. Recarga para ver el cambio.").

### Fuera de alcance

- Notificaciones en tiempo real (Durable Objects): el panel usa polling de 10 s.
- Reasignar pedidos entre sucursales; editar ítems de un pedido.

### Pruebas requeridas

- [ ] Tabla de transiciones: todas las válidas pasan y todas las inválidas dan `INVALID_TRANSITION`, por modalidad.
- [ ] Dos transiciones con la misma `version` en paralelo → una 200 y otra 409.
- [ ] `staff` de otra sucursal → 404; `staff` cancelando → 403.
- [ ] `rejected` sin motivo → 400.
- [ ] Listado con `since` solo devuelve pedidos cambiados después; `ETag` sin cambios → 304.
- [ ] El historial registra actor y momento de cada cambio.
- [ ] Aislamiento en todas las rutas nuevas.

### Criterios de aceptación

- [ ] El listado del panel usa un solo `batch` y filtra por sucursal en SQL.
