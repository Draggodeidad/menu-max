# Fase B4 — Catálogo, menú y onboarding

> Planeación local (en `.gitignore`).
> **Criterio para cerrar la fase:** `/crear` en un solo envío deja un menú publicado con QR; una cuenta sin verificar no recibe pedidos de comensales.
> **Orden de ejecución:** T15 → T20, en orden numérico.
> **Convención de rutas de esta fase:** `/v1/orgs/:orgId/branches/:branchId/...` siempre con `requireBranch()` y `canAccessBranch`.

---

## T15 — Negocio y sucursales: datos, horarios, modalidades, mesas y zonas

**Fase:** B4 · **Depende de:** T12, T14 · **ADR:** 016, 018 (Propuesto) · **Rama sugerida:** `feat/t15-negocio-sucursales`

> Las zonas por código postal dependen de ADR-018 (`Propuesto`). Si no está aceptado, implementa todo lo demás y deja las zonas para cuando se confirme.

### Objetivo

El negocio configura sus sucursales con todo lo que el checkout necesita validar: horario, modalidades, mesas, zonas de entrega y número de avisos.

### Alcance

- Migración que agrega a `branches`: `contact_phone`, `mode_table`, `mode_pickup`, `mode_delivery` (booleanos, al menos uno verdadero; validado en servicio), `table_count` (0–200), `max_order_total_cents` (nullable), `alert_whatsapp` (E.164, nullable), `alert_opt_in_at`, `next_order_number` (default 1), `version`.
- Tablas nuevas:
  - `business_hours (id, organization_id, branch_id, weekday 0–6, opens_at 'HH:MM', closes_at 'HH:MM')`; varios rangos por día; un rango que cruza medianoche se guarda como dos.
  - `delivery_zones (id, organization_id, branch_id, name, postal_codes text (JSON), fee_cents, active, version)` (ADR-018).
- `modules/businesses/hours.ts`: funciones puras `isOpen(hours, timezone, now)` y `nextOpening(hours, timezone, now)` con `Intl.DateTimeFormat` y la zona de la sucursal.
- Rutas:
  - `GET /business` (`settings:read`), `PATCH /business` (`settings:write`) → nombre;
  - `GET /branches` (`settings:read`; `staff` solo ve las suyas), `POST /branches` (`branches:manage` + `assertWithinLimit('branches')`), `GET/PATCH /branches/:branchId` (`settings:write` para editar; `version` obligatorio);
  - `PUT /branches/:branchId/hours` (`settings:write`) → reemplaza la semana completa en un `batch`;
  - `GET/POST/PATCH/DELETE /branches/:branchId/zones` (`settings:write`).
- Guardar `alert_whatsapp` registra `alert_opt_in_at` (la persona que lo captura confirma que el número aceptó recibir avisos). El envío real depende de correo verificado (T24).

### Fuera de alcance

- Menús y catálogo (T16), tema (T18).
- Mapas, geocodificación o tarifas por distancia.

### Pruebas requeridas

- [ ] `isOpen` y `nextOpening`: rangos normales, cruce de medianoche, día cerrado, varios rangos.
- [ ] `PATCH` con `version` vieja → 409.
- [ ] Desactivar las tres modalidades → `VALIDATION_FAILED`.
- [ ] Segunda sucursal en plan `free` → 402.
- [ ] `staff` no puede editar sucursal; `admin` sí.
- [ ] Código postal repetido en dos zonas activas de la misma sucursal → `CONFLICT`.
- [ ] Aislamiento en todas las rutas nuevas.

### Criterios de aceptación

- [ ] Horarios y zonas se reemplazan atómicamente (un `batch`).

---

## T16 — Catálogo: menús, categorías, productos, variantes y opciones

**Fase:** B4 · **Depende de:** T15 · **ADR:** 003, 016 · **Rama sugerida:** `feat/t16-catalogo`

### Objetivo

Cada sucursal tiene un menú editable con categorías, productos, variantes y opciones, con concurrencia optimista y sin borrar historial.

### Alcance

- Tablas y migración (todas con `organization_id`, `version`, `created_at`, `updated_at`; borrado lógico donde se indica):
  - `menus (id, organization_id, branch_id unique, slug unique, status check in ('draft','published'), menu_version integer default 1, published_at)` — el slug y la publicación se completan en T18;
  - `categories (id, organization_id, menu_id, name, position, deleted_at)`;
  - `products (id, organization_id, menu_id, category_id, name, description, price_cents, available, position, deleted_at)`;
  - `product_variants (id, organization_id, product_id, name, price_cents, position)` — si existen, el precio de la variante reemplaza al del producto;
  - `option_groups (id, organization_id, product_id, name, min_select, max_select, position)`;
  - `options (id, organization_id, option_group_id, name, price_delta_cents, position)`.
- Políticas en `shared/authz/policies.ts` si hacen falta (p. ej. el producto pertenece al menú de la sucursal).
- Rutas bajo `/branches/:branchId/menu`:
  - `GET /` (`catalog:read`) → menú completo para el panel (incluye no disponibles y borrados no);
  - `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` (`catalog:write`; borrar categoría con productos activos → `BUSINESS_RULE`);
  - `PUT /categories/order` y `PUT /categories/:id/products/order` (`catalog:write`);
  - `POST /products` (`catalog:write` + `assertWithinLimit('products')`), `PATCH /products/:id`, `DELETE /products/:id` (lógico);
  - `PATCH /products/:id/availability` (`catalog:availability`) → `{ available, version }`;
  - variantes y grupos de opciones se envían anidados en `POST/PATCH /products` y se reemplazan completos en el mismo `batch`.
- **Toda mutación del catálogo incrementa `menus.menu_version` en el mismo `batch`** (invalida la caché de T18).
- Lectura del panel en un solo `db.batch` de consultas, sin N+1.

### Fuera de alcance

- Imágenes (T17), publicación y lectura pública (T18).
- Compartir productos entre menús o sucursales (ADR-016).

### Pruebas requeridas

- [ ] Crear, editar y borrar (lógico) categoría y producto; el producto borrado no aparece en `GET`.
- [ ] `PATCH` con `version` vieja → 409.
- [ ] Cada mutación sube `menu_version` exactamente en 1.
- [ ] `staff` cambia disponibilidad pero no precio (403).
- [ ] `min_select > max_select` o precio negativo → `VALIDATION_FAILED`.
- [ ] Producto 61 en plan `free` → 402.
- [ ] `GET /menu` con 20 categorías y 200 productos usa ≤ 4 consultas.
- [ ] Aislamiento en todas las rutas nuevas.

### Criterios de aceptación

- [ ] Ningún precio se guarda fuera de centavos enteros.

---

## T17 — Subidas de imágenes a R2

**Fase:** B4 · **Depende de:** T16 · **ADR:** — · **Rama sugerida:** `feat/t17-media-r2`

### Objetivo

El panel sube fotos de productos, logo y portada de forma segura, y la API entrega URLs listas para el frontend.

### Alcance

- Binding R2 `MEDIA` por entorno; `MEDIA_PUBLIC_BASE_URL` (dominio público del bucket, configurado por un humano).
- Tabla `media_assets (id, organization_id, key, content_type, size_bytes, width, height, created_by_member_id, created_at, deleted_at)`; columna `products.image_asset_id` (FK).
- `POST /v1/orgs/:orgId/media` (`catalog:write`):
  - límite de cuerpo propio de 5 MB (sustituye al de 64 KB solo en esta ruta);
  - cuerpo binario con `content-type` declarado, pero el tipo real se decide por _magic bytes_: JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF????WEBP`; cualquier otro → `VALIDATION_FAILED`;
  - ancho y alto leídos de la cabecera del archivo (sin decodificar la imagen); máximo 6000 px por lado;
  - llave `org/{orgId}/media/{uuidv7}.{ext}`; `put` con `contentType` real y `cacheControl: public, max-age=31536000, immutable`;
  - responde `{ id, url, width, height }`.
- `DELETE /v1/orgs/:orgId/media/:mediaId` (`catalog:write`) → borrado lógico; el objeto se elimina en el Cron de T26.
- `PATCH /products/:id` acepta `imageAssetId` validando que el asset sea de la misma organización.
- Los DTOs devuelven `imageUrl`, `imageWidth`, `imageHeight`; el frontend nunca construye rutas de R2.

### Fuera de alcance

- Redimensionar, recortar o quitar EXIF (Cloudflare Images queda como opcional en el README).
- Subidas presignadas directas desde el navegador.

### Pruebas requeridas

- [ ] JPEG, PNG y WebP válidos → 201 con dimensiones correctas.
- [ ] Un `.exe` renombrado a `.jpg` con `content-type: image/jpeg` → rechazo.
- [ ] 5 MB + 1 byte → 413.
- [ ] `imageAssetId` de otra organización → 404.
- [ ] La llave del objeto no contiene el nombre original del archivo.

### Criterios de aceptación

- [ ] El objeto existe en R2 local y su metadato en D1 tras subirlo.

---

## T18 — Tema, slug, publicación y lectura pública del menú

**Fase:** B4 · **Depende de:** T16, T17 · **ADR:** 008, 014 · **Rama sugerida:** `feat/t18-tema-publicacion`

> El estado "menú inactivo" tras los días de gracia depende de ADR-008 (`Propuesto` en esa parte). Si no está aceptado, implementa `acceptingOrders` y deja la gracia fuera.

### Objetivo

El negocio personaliza y publica su menú, y cualquier comensal puede leerlo por su slug con solo los datos publicables.

### Alcance

- Tabla `storefront_themes (id, organization_id, menu_id unique, preset, primary_color, background_color, text_color, font_preset, product_layout, logo_asset_id, cover_asset_id, version, updated_at)`. Presets y fuentes como en `DESIGN.md §3.2–3.3`.
- `PUT /branches/:branchId/menu/theme` (`settings:write`):
  - colores `#RRGGBB`;
  - contraste WCAG ≥ 4.5 entre `primary` y `background`, y entre `text` y `background`; si falla, `VALIDATION_FAILED` con `fieldErrors` que dicen qué color cambiar;
  - incrementa `menu_version`.
- Slug:
  - se genera del nombre del negocio (minúsculas, sin acentos, guiones; sufijo `-2`, `-3` si existe);
  - lista de reservados: `app`, `api`, `admin`, `m`, `pedido`, `crear`, `entrar`, `docs`, `webhooks`, `invitacion`, `verificar-correo`, `restablecer`;
  - `PATCH /menu/slug` (`settings:write`) solo mientras el menú **nunca** se ha publicado; después → `BUSINESS_RULE` ("El enlace ya está en tus QR impresos y no se puede cambiar.").
- `POST /branches/:branchId/menu/publish` (`storefront:publish`): requiere al menos un producto disponible; marca `published`, `published_at`, sube `menu_version`. **No** exige correo verificado (ADR-008). `POST /unpublish` igual.
- `modules/storefront/acceptance.ts`: `acceptingOrders(menu, org, branch, now)` = publicado ∧ algún `owner` de la org con correo verificado ∧ suscripción no suspendida ∧ sucursal abierta. Devuelve también el motivo (`'unverified' | 'suspended' | 'closed'`).
- Rutas públicas (rate limit `public`):
  - `GET /v1/public/menus/:slug` → `PublicMenuDto`: negocio, sucursal, `contactPhone`, horario de hoy, `isOpen`, `nextOpening`, modalidades, mesas válidas, zonas (nombre, tarifa; sin códigos postales), tema con URLs de assets, categorías y productos **disponibles** con variantes y opciones, `acceptingOrders`, `menuVersion`. No publicado → 404.
  - `GET /v1/public/menus/:slug/version` → `{ menuVersion }` (lectura mínima para la llave de caché en WEB, ADR-014).
- Consultas públicas dedicadas en `storefront.repository.ts`; no se reutilizan las del panel.

### Fuera de alcance

- Caché en WEB (task de frontend, ADR-014).
- QR (T19).

### Pruebas requeridas

- [ ] Colores con contraste insuficiente → error con el campo correcto.
- [ ] Slugs: acentos, duplicados, reservados.
- [ ] Cambiar slug tras publicar → 422.
- [ ] Menú no publicado → 404 público; publicado → 200 sin productos no disponibles ni borrados.
- [ ] `PublicMenuDto` no incluye ids de organización, códigos postales, `alert_whatsapp` ni datos de miembros (prueba contra el esquema estricto).
- [ ] `acceptingOrders` es `false` con owner sin verificar, con suscripción suspendida y fuera de horario, con el motivo correcto.
- [ ] Lectura pública en un solo `batch`.

### Criterios de aceptación

- [ ] Publicar con correo sin verificar funciona y `acceptingOrders` queda en `false` con motivo `unverified`.

---

## T19 — Código QR por menú y por mesa

**Fase:** B4 · **Depende de:** T18 · **ADR:** 017 (Propuesto) · **Rama sugerida:** `feat/t19-qr`

> Requiere la dependencia `uqr` (ADR-017, `Propuesto`). No la instales hasta que el ADR esté aceptado.

### Objetivo

El negocio descarga un QR permanente de su menú y uno por mesa, listos para imprimir.

### Alcance

- `GET /v1/orgs/:orgId/branches/:branchId/qr` (`organization:read`):
  - query `mesa` opcional (1…`table_count`); fuera de rango → `VALIDATION_FAILED`;
  - contenido: `${WEB_ORIGIN}/m/${slug}` o `${WEB_ORIGIN}/m/${slug}?mesa=${n}`;
  - respuesta `image/svg+xml` generada con `uqr`, corrección de errores nivel M, margen de 4 módulos, sin texto ni scripts;
  - `Cache-Control: private, max-age=300`.
- Menú no publicado → `BUSINESS_RULE` ("Publica tu menú para descargar el QR.").
- El SVG se genera en la API; el frontend lo muestra tal cual (único caso permitido de `{@html}` según `apps/web/AGENTS.md`).

### Fuera de alcance

- PNG o PDF para imprimir; personalizar colores o logo del QR.

### Pruebas requeridas

- [ ] El SVG decodifica a la URL esperada (decodificador en la prueba o comparación con salida conocida de `uqr`).
- [ ] El SVG no contiene `<script`, `on*=` ni referencias externas.
- [ ] `mesa=0` o mayor a `table_count` → 400.
- [ ] Aislamiento.

---

## T20 — Onboarding en un solo envío (`POST /v1/onboarding`)

**Fase:** B4 · **Depende de:** T09, T10, T14, T18 · **ADR:** 008, 013 · **Rama sugerida:** `feat/t20-onboarding`

### Objetivo

"Publicar menú" en `/crear` crea cuenta, organización, negocio, sucursal, menú y productos, y deja el menú publicado, sin quedar a medias aunque haya reintentos.

### Alcance

- `POST /v1/onboarding` (rate limit `auth`), header `Idempotency-Key` (UUID) obligatorio y Turnstile en header `x-turnstile-token`.
- Entrada (`OnboardingInput`, estricto): `{ businessName, products: [{ name, priceCents }] (1…plan free), modes: { table, pickup, delivery }, alertWhatsapp?, account: { email, password } }`.
- Pasos, en este orden:
  1. Turnstile; cuota de 3 altas por IP por día; `assertDeliverableEmail`.
  2. Si hay sesión y el usuario **no** tiene organizaciones → salta al paso 4 (reanudación).
  3. Sin sesión: `auth.api.signUpEmail` con `asResponse` para obtener la cookie. Correo ya registrado → `CONFLICT` ("Ya tienes una cuenta con este correo. Entra para publicar tu menú."). _En el alta es inevitable revelar que el correo existe porque el registro da sesión inmediata; lo mitigan Turnstile y la cuota por IP (ADR-008)._
  4. Idempotencia (ADR-013): misma llave y mismo cuerpo → misma respuesta; otro cuerpo → `IDEMPOTENCY_CONFLICT`. Esta task crea la tabla `idempotency_keys (key pk, organization_id, scope, request_hash, status_code, response_json, expires_at)` y el helper reutilizable `shared/idempotency.ts`.
  5. Un solo `db.batch`: `organizations`, membresía `owner`, `subscriptions` (`free`, `trialing`), `businesses`, `branches` (modalidades, `alert_whatsapp`), `menus` (slug generado, `published`), una categoría "Menú", productos, tema `minimal`, registro de idempotencia.
  6. Encola `verify-email` (lo hace Better Auth en el alta) y responde `201 { orgId, branchId, menuSlug, menuUrl }` con la cookie de sesión.
- Si el `batch` falla, el usuario queda con sesión y sin organización: el reintento desde `/app` con la misma llave entra por el paso 2.
- Usuario con sesión que ya tiene organización → `CONFLICT`.

### Fuera de alcance

- Fotos, horarios y zonas en el alta (se editan después en ajustes).
- Pantalla `/crear` (frontend).

### Pruebas requeridas

- [ ] Caso feliz: una petición deja todo creado y `GET /v1/public/menus/:slug` responde con los productos.
- [ ] Mismo `Idempotency-Key` y mismo cuerpo dos veces → una sola organización y la misma respuesta.
- [ ] Mismo `Idempotency-Key` con otro cuerpo → 409 `IDEMPOTENCY_CONFLICT`.
- [ ] Falla simulada del `batch` → usuario sin org; el reintento con sesión completa el alta.
- [ ] Correo desechable, sin MX o Turnstile inválido → rechazo antes de crear el usuario.
- [ ] Cuarta alta del día desde la misma IP → 429.
- [ ] El menú recién creado tiene `acceptingOrders: false` con motivo `unverified`.

### Criterios de aceptación

- [ ] Una sola llamada HTTP desde WEB basta para pasar de `/crear` a `/app/listo`.
