# Fase B5 — Pedidos

> Planeación del backend (versionada en git).
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

### Decisiones al implementar (acordadas el 2026-11-17)

- **Token de seguimiento (enmienda de ADR-013):**
  - es `base64url(HMAC-SHA256(ORDER_TOKEN_SECRET, "order-tracking:v1:" + orderId))`, de 32 bytes como los tokens aleatorios;
  - `orders` guarda solo `SHA-256(token)` y el seguimiento (T22) busca por ese hash;
  - `idempotency_keys.response_json` guarda `{ orderId, number, status, totalCents }` sin el token; el reintento lo vuelve a derivar del `orderId`;
  - secreto nuevo `ORDER_TOKEN_SECRET`.
- **Orden del flujo** (reemplaza el de «Alcance»):
  1. Zod y `request_hash` del cuerpo canónico más el usuario de la sesión, si hay. La llave no sirve con otra sesión.
  2. La llave en `idempotency_keys`:
     - mismo hash → respuesta guardada con el token derivado, sin Turnstile ni cuotas;
     - otro hash → `IDEMPOTENCY_CONFLICT`.
       Va antes de leer el menú: el reintento no depende de que la sucursal siga abierta o el menú publicado.
  3. Turnstile y cuota por IP; menú por slug (`404` si no está publicado) y cuota por teléfono y sucursal; reglas; cálculo.
  4. Un solo `db.batch`. Si otro envío registró la misma llave a la vez, la llave primaria revierte el batch y se responde con lo guardado por el primero.
- **Pedido de prueba:**
  - `is_test` lo decide el servidor: hay sesión de un miembro activo de la organización y, si es `staff`, de esa sucursal;
  - salta los motivos `unverified` y `closed` de `acceptingOrders` (el alta no captura horarios);
  - `unpublished`, `suspended` e `inactive` (gracia vencida, ADR-008) bloquean;
  - modalidad, mesa, zona, Turnstile y cuotas aplican igual;
  - lleva outbox solo si algún dueño tiene el correo verificado.
- **Errores:**
  - las reglas del negocio y los errores por ítem responden `BUSINESS_RULE` (422), con `fieldErrors` en `items.N.productId|variantId|optionIds|quantity`, `mode`, `tableNumber` y `delivery.postalCode`;
  - exceder cualquiera de las dos cuotas responde `RATE_LIMITED` (429) con `Retry-After`.
- **Catálogo:**
  - con variantes, `variantId` es obligatorio; sin variantes, se rechaza;
  - un producto en una categoría borrada cuenta como no disponible;
  - opciones repetidas o de otro producto → error en `optionIds`;
  - el tope `max_order_total_cents` se compara contra el total con envío.
- **Esquema** (además de lo listado en «Alcance»):
  - únicos `(organization_id, id)` y `(organization_id, branch_id, number)`;
  - FKs compuestas a sucursal, menú, zona, pedido, producto y miembro;
  - `CHECK` de estado, modalidad, pago, moneda, mesa solo en `table`, dirección y zona solo en `delivery`, `total = subtotal + envío` y `line_total = unitario × cantidad`;
  - `ORDER_STATUSES` ya trae los 9 estados de T23 para no reconstruir `orders`.
- **Outbox:** `payload_json = { orderId }`, sin datos personales. `notification_outbox` no lleva `order_id` propio: el relay es de T24.
- **Topes de texto:**

  | Campo               | Máximo |
  | ------------------- | ------ |
  | Nombre              | 80     |
  | Notas del pedido    | 500    |
  | Notas de la línea   | 200    |
  | Campos de dirección | 120    |
  | Referencias         | 200    |

- **Concurrencia:** envíos simultáneos con la misma llave pasan la consulta rápida y cada uno cuenta en las cuotas. El cuarto de un mismo teléfono puede recibir `429` en lugar de la respuesta guardada; los reintentos secuenciales no cuentan.

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

### Decisiones al implementar (acordadas el 2026-11-22)

- **Token:** todo valor se hashea y se busca, aunque su formato sea inválido. No hay salida temprana que distinga por tiempo un token malformado de uno inexistente.
- **DTO:** se limita a la lista de «Alcance». No lleva nombre del comensal, notas, opciones, costo de envío, motivo de rechazo ni `isTest`. La colonia va en `deliveryNeighborhood` (`null` fuera de domicilio).
- **`ETag`:** solo `orders.version`. Si cambia el nombre o teléfono de la sucursal, una página abierta lo ve en la siguiente transición o al recargar.
- **Disponibilidad:** el seguimiento sigue funcionando con la organización suspendida o la sucursal borrada.
- **Vigencia:** el enlace no vence por ahora; la retención se decide con ADR-015 en T26.

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
