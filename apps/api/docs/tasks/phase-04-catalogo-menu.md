# Fase B4 — Catálogo, menú y onboarding

> Planeación del backend (versionada en git).
> **Criterio para cerrar la fase:** `/crear` en un solo envío deja un menú publicado con QR; una cuenta sin verificar no recibe pedidos de comensales.
> **Orden de ejecución:** T15 → T20c, en orden numérico.
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
- [ ] Producto 51 en plan `free` → 402.
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

**Fase:** B4 · **Depende de:** T14b, T16, T17 · **ADR:** 008, 014 · **Rama sugerida:** `feat/t18-tema-publicacion`

> El estado "menú inactivo" tras los días de gracia depende de ADR-008 (`Propuesto` en esa parte). Si no está aceptado, implementa `acceptingOrders` y deja la gracia fuera.

### Objetivo

El negocio personaliza y publica su menú, y cualquier comensal puede leerlo por su slug con solo los datos publicables.

### Alcance

- Tabla `storefront_themes (id, organization_id, menu_id unique, preset, primary_color, background_color, text_color, font_preset, product_layout, logo_asset_id, cover_asset_id, version, updated_at)`. Presets y fuentes como en `DESIGN.md §3.2–3.3`.
- `PUT /branches/:branchId/menu/theme` (`settings:write`):
  - colores `#RRGGBB`;
  - contraste WCAG ≥ 4.5 entre `primary` y `background`, y entre `text` y `background`; si falla, `VALIDATION_FAILED` con `fieldErrors` que dicen qué color cambiar;
  - incrementa `menu_version`.
- **Marca por plan (T14b):**
  - sin `customTheme` (plan `free`): solo se aceptan `preset` y `primary_color`; enviar `background_color`, `text_color`, `font_preset`, `product_layout`, `logo_asset_id` o `cover_asset_id` → `PLAN_LIMIT_REACHED`;
  - columna `show_branding` (`not null default true`) en `storefront_themes`; ponerla en `false` exige `removeBranding`;
  - el tema guardado **no se borra** al bajar de plan: la lectura pública calcula el tema efectivo según el plan vigente (sin `customTheme`, preset y color principal con el resto por defecto; sin `removeBranding`, sello visible). Al volver a `pro`, reaparece lo guardado;
  - `PublicMenuDto.theme` incluye `showBranding`.
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
- [ ] Plan `free`: guardar logo o quitar el sello → 402; preset y color principal → ok.
- [ ] Organización que baja de `pro` a `free` con tema personalizado: el menú público muestra el tema base con sello y la fila guardada no cambia.
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

**Fase:** B4 · **Depende de:** T18 · **ADR:** 017 · **Rama sugerida:** `feat/t19-qr`

> Usa la dependencia `uqr` (ADR-017, aceptado el 2026-11-17).

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
- Limitar el QR por mesa según el plan: está en `free` y en `pro`. Un negocio que solo atiende en mesa lo necesita para recibir pedidos, y la URL `?mesa=N` funciona con o sin el SVG.

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
  5. Un solo `db.batch`: `organizations`, membresía `owner`, `subscriptions` (`pro`, `trialing`, `current_period_end` = alta + 90 días: prueba gratis con todas las funciones), `businesses`, `branches` (modalidades, `alert_whatsapp`), `menus` (slug generado, `published`), una categoría "Menú", productos, tema `minimal`, registro de idempotencia.
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
- [ ] La organización nueva queda con suscripción `pro` + `trialing` y `current_period_end` a 90 días del alta (`GET /subscription` lo muestra).

### Criterios de aceptación

- [ ] Una sola llamada HTTP desde WEB basta para pasar de `/crear` a `/app/listo`.

### Notas

- **Prueba de 3 meses (Release 1, acordado 2026-11-14):** todo cliente nuevo opera 90 días con el plan `pro` sin costo. El plan y la duración salen de constantes del servicio de onboarding (`TRIAL_PLAN_ID = "pro"`, `TRIAL_DAYS = 90`); los límites siguen leyéndose de `plans`.
- El tope de productos del alta es `max_products` del plan `free` (50), leído de `plans`, para que el menú inicial quepa en el plan al que pasará la cuenta al terminar la prueba.
- El paso a `free` al vencer y sus avisos son la T20b. Sin T20b, una prueba vencida sigue operando como `pro`.

---

## T20b — Fin de la prueba: avisos y paso automático a Free

**Fase:** B4 · **Depende de:** T08, T14, T15, T16, T20 · **ADR:** 007, 011 · **Rama sugerida:** `feat/t20b-fin-de-prueba`

> Límites de `free` aprobados el 2026-11-14 (1 sucursal / 50 productos / 3 miembros activos, incluido el dueño). Debe estar en producción antes de que venza la primera prueba (90 días después de la primera alta real).

### Objetivo

Cuando se cumplen los 3 meses de prueba, la organización pasa sola al plan `free` sin perder el servicio, y su dueño lo supo con anticipación por correo.

### Alcance

- Cron diario existente (`0 9 * * *`, `index.ts → scheduled`): dos tareas nuevas en `modules/subscriptions`, independientes de la limpieza (si una falla, las demás corren y se registra el error).
- **Avisos previos**, 15 y 3 días antes de `current_period_end`, solo para suscripciones `trialing`:
  - columnas nuevas en `subscriptions`: `trial_notice_15_sent_at`, `trial_notice_3_sent_at` (`integer` ms, nullable);
  - orden obligatorio: **primero se encola, después se marca**. `trial_notice_N_sent_at` se escribe solo cuando `enqueue` terminó bien. Si encolar falla, la columna sigue en `null` y el Cron del día siguiente lo reintenta; nunca se marca como enviado un aviso que no salió;
  - entrega _at least once_: si falla la marca después de encolar, el aviso puede repetirse una vez. Es aceptable; perderlo no;
  - el aviso de 15 días ya no se envía si faltan 3 días o menos (se manda solo el de 3);
  - destinatarios: los `owner` activos de la organización con `email_status` entregable;
  - plantilla `trial-ending` (`email.send`, por la cola): cuántos días faltan, fecha de cambio, qué conserva y qué se limita en `free` (leído de `plans`, no escrito a mano), enlace a `${WEB_ORIGIN}/app/ajustes`.
- **Transición**: suscripciones `trialing` con `current_period_end <= now` → `plan_id = 'free'`, `status = 'active'`, `current_period_end = null` y `trial_ended_notice_pending_at = now`, todo en el mismo `UPDATE` condicional (idempotente). El aviso pendiente queda guardado junto con el cambio de plan.
- **Aviso de fin de prueba**: el Cron toma las filas con `trial_ended_notice_pending_at` no nulo, encola `trial-ended` a los `owner` y solo entonces pone la columna en `null`. Si encolar falla, la fila sigue pendiente y se reintenta en la siguiente corrida.
- **Excedentes (regla del piloto):** lo que excede los límites de `free` **no se borra, no se oculta y sigue operando**. Una cuenta que termina la prueba con tres sucursales conserva las tres recibiendo pedidos; `assertWithinLimit` (T14) solo bloquea nuevas altas del recurso que alcanzó su límite. Texto del correo: "Conservas tus sucursales actuales. Para agregar otra necesitas Pro." (igual para productos y miembros).
- Los correos solo anuncian límites que la API ya hace cumplir: sucursales (T15), productos (T16) y miembros (T14). La marca del menú se menciona solo si T18 ya está en producción.
- Procesa por lotes con cursor (≤ 100 suscripciones por consulta) y registra `subscription.trial_notice_sent` y `subscription.trial_ended` con `orgId`, sin PII.
- Actualizar `docs/runbooks/cambiar-plan.md`: cómo extender una prueba (mover `current_period_end` y limpiar los `trial_notice_*`).

### Fuera de alcance

- Cobro, pasarela de pagos, página de precios y descuentos de lanzamiento: Release 2 (pagos en línea están fuera del MVP).
- Restringir funciones por plan más allá de los límites de `plans` (_feature gating_): Release 2.
- Avisos dentro del panel o por WhatsApp; texto de los Términos y Condiciones (frontend, task-14).

### Datos

- Migración: tres columnas nullable en `subscriptions` (`trial_notice_15_sent_at`, `trial_notice_3_sent_at`, `trial_ended_notice_pending_at`) e índice `(status, current_period_end)` para el barrido del Cron. Solo _expand_; no es destructiva.

### Pruebas requeridas

- [ ] A 15 y a 3 días se encola un aviso por `owner`; correr el Cron dos veces el mismo día no lo duplica.
- [ ] `enqueue` falla en un aviso previo → la columna sigue en `null` y la siguiente corrida lo envía.
- [ ] `enqueue` falla tras el cambio de plan → la cuenta ya es `free`, el aviso sigue pendiente y la siguiente corrida lo envía sin volver a cambiar el plan.
- [ ] Una prueba creada con menos de 15 días restantes recibe solo el aviso de 3 días.
- [ ] Vencida: queda `free` + `active` sin `current_period_end` y se encola `trial-ended`; correr el Cron de nuevo no cambia nada.
- [ ] Suscripciones `active`, `past_due` o `suspended` no se tocan aunque tengan `current_period_end` vencido.
- [ ] Organización que termina la prueba con 3 sucursales y 80 productos: todo sigue operando y recibiendo pedidos; crear una sucursal o un producto más → `PLAN_LIMIT_REACHED`.
- [ ] Una tarea del Cron que falla no detiene a las demás.
- [ ] Los correos no contienen límites escritos a mano: cambian si cambia la fila de `plans`.

### Criterios de aceptación

- [ ] Ningún cliente pierde acceso ni datos al terminar la prueba.
- [ ] Antes de publicar: `POST /branches` (T15) y `POST /products` (T16) responden 402 al superar el límite de `free` en staging, tal como lo anuncia el correo.
- [ ] Los correos salen por la cola, nunca en línea, y los logs no llevan PII.

### Notas

- Una suscripción `suspended` durante la prueba no pasa a `free` sola: la reactiva un humano con el runbook.
- Si los límites de `free` cambian después de fusionar T14, van en una migración nueva (no se edita `0005`).
- Antes del lanzamiento comercial (Release 2) se decide si las sucursales que exceden el plan pasan a modo consulta. En el piloto siguen operando.
- ADR-011 reserva el outbox para pedidos y encola `email.send` directo porque el usuario puede pedir reenvío. Aquí nadie puede pedirlo, por eso el estado del aviso vive en `subscriptions`; no se crea una tabla de outbox nueva.
- **Decisiones al implementar (acordadas el 2026-11-17):**
  - Ventanas: el aviso de 15 días sale si faltan más de 3 y hasta 15 días **y** la prueba duró al menos 15 días (`created_at <= current_period_end − 15 d`); el de 3, si faltan más de 0 y hasta 3. Así una prueba creada con menos de 15 días recibe solo el de 3, y un aviso que falló se reintenta al día siguiente.
  - Días restantes = `ceil((current_period_end − now) / 1 día)`; la fecha del correo se muestra en `America/Mexico_City`.
  - "Conservas tus … actuales. Para agregar otro necesitas Pro." solo aparece por cada recurso cuyo uso ya alcanza o supera el límite de `free`; los límites y capacidades de `free` se listan siempre, leídos de `plans`.
  - Sin `owner` activo con correo entregable, el aviso se da por resuelto y se registra `subscription.trial_notice_skipped` (no hay a quién reintentar). Los destinatarios no necesitan el correo verificado.
  - El paso a `free` sube `menu_version` de los menús de la organización en el mismo `db.batch`: el tema público depende de las capacidades del plan (ADR-014).
  - Lotes de 50 suscripciones: D1 admite 100 parámetros por sentencia y las que llevan `inArray(ids)` suman algunos más.
  - Las tareas del Cron corren con `Promise.allSettled`; si alguna falla, se registra `cron.task_failed` y la corrida falla al final para que se vea en Cloudflare.

---

## T20c — Aviso al correo que ya tiene cuenta cuando alguien intenta registrarse

**Fase:** B4 · **Depende de:** T08, T20 · **ADR:** 008, 010, 011, 020 · **Rama sugerida:** `feat/t20c-aviso-cuenta-existente`

> Planeada el 2026-11-17 al cerrar T20 (#70). Cumple la viñeta de ADR-008 «registrarse con un correo existente envía un aviso a ese correo», que T20 dejó fuera de su alcance. No cambia el contrato de `POST /v1/onboarding`: la respuesta, el código y el mensaje siguen idénticos, así que WEB no se rompe aunque esta task salga antes o después de la task-15 del frontend.

### Objetivo

Cuando alguien intenta crear una cuenta en `/crear` con un correo que ya está registrado, el dueño real de ese correo recibe un aviso con los enlaces para entrar o restablecer su contraseña. Así sabe del intento aunque no haya sido él.

### Alcance

- **Plantilla nueva `account-exists`** (`packages/contracts/src/jobs.ts`):
  - se agrega a `EMAIL_TEMPLATES` y a la unión `EmailSendJob` con `data: { signInUrl: Link, resetUrl: Link }`;
  - es un valor nuevo de un enum interno de la cola: productor y consumidor viven en el mismo Worker, así que no hay desfase en el despliegue;
  - el cambio es compatible, porque `apps/web` no consume `EMAIL_TEMPLATES`.
- **Texto** en `infrastructure/mailer/templates.ts`, en español de México y con el tono de `DESIGN.md §6`, en texto plano y HTML simple, sin tracking (ADR-020):
  - Asunto: «Alguien intentó crear una cuenta con tu correo en MenusMax».
  - Cuerpo: «Alguien intentó crear un menú en MenusMax con este correo, que ya tiene una cuenta. Si fuiste tú, entra para publicar tu menú: [Entrar]. Si no recuerdas tu contraseña, restablécela: [Restablecer contraseña]. Si no fuiste tú, no tienes que hacer nada: tu cuenta sigue igual.»
  - Sin datos del intento (nombre del negocio, IP, productos): el correo no debe servir para enviar texto arbitrario a un tercero.
- **Enlaces** en `modules/auth/web-links.ts`:
  - ruta nueva `signIn: "/entrar"` con `signInLink(env)`;
  - `resetPasswordLink(env)` sin token, que ya existe y abre la pantalla para pedir un enlace;
  - ningún enlace lleva token ni el correo.
- **Envío** desde `modules/auth/auth.service.ts` con una función nueva `notifyExistingAccount(deps, email)`:
  - encola `email.send` con `sendAuthEmail` y `waitUntil`: la respuesta no espera a la cola y su tiempo no cambia;
  - no envía si `users.email_status = 'undeliverable'` (ADR-008);
  - una falla al encolar se registra y no cambia la respuesta (ADR-011: los correos de auth se encolan directo).
- **Cuándo se llama.** `modules/onboarding/onboarding.service.ts` la llama en los dos caminos de T20 que terminan en `CONFLICT` con `ACCOUNT_ALREADY_EXISTS_MESSAGE`:
  1. `createOwnerAccount` rechaza el correo porque ya existe (incluye la carrera entre la consulta y el registro);
  2. sin sesión, la `Idempotency-Key` ya está registrada con el mismo cuerpo.

  En los dos casos se llama después de Turnstile, la cuota por IP y `assertDeliverableEmail`, que T20 ya aplica.

- **Cuota contra el uso del aviso para acosar a un tercero** (`rate_counters`, ventanas fijas en UTC como en ADR-010):
  - límite: 1 aviso por hora y 3 por día por correo;
  - llave: `account-exists-hour:<sha256(correo normalizado)>` y `account-exists-day:<…>`, con el mismo `emailDigest` del reset, nunca el correo en claro;
  - cuota excedida: no se encola y la respuesta sigue siendo el mismo `409 CONFLICT`. Nunca `429`: quien intenta registrarse no debe distinguir si se envió el aviso.
- **Logs:** `auth.existing_account_notified` y `auth.existing_account_notice_skipped` (con `reason: "quota" | "undeliverable"`), solo con `requestId`.
- **Documentación:**
  - agregar a la tabla de cuotas de ADR-010 la fila «Aviso de cuenta existente · 1 por hora, 3 por día · Correo normalizado (hash)»;
  - marcar en ADR-008 que la viñeta queda implementada en T20c.
  - Las dos ediciones van en el mismo PR, como hizo T18 con la gracia.

### Fuera de alcance

- Cambiar la respuesta, el código o el mensaje de `POST /v1/onboarding`.
- Aceptar una invitación con un correo que ya tiene cuenta (`AUTH_REQUIRED`, T13): quien recibe la invitación ya sabe que su correo tiene cuenta.
- Avisos por WhatsApp o dentro del panel.
- La pantalla `/restablecer` y el manejo del error en `/crear`: frontend (task-15 de `docs/tasks/`).

### Archivos esperados

- `packages/contracts/src/jobs.ts`: plantilla `account-exists`.
- `apps/api/src/infrastructure/mailer/templates.ts` (+ `mailer.test.ts`): texto y HTML.
- `apps/api/src/modules/auth/web-links.ts`: `signInLink`.
- `apps/api/src/modules/auth/auth.service.ts`: `notifyExistingAccount` y su cuota.
- `apps/api/src/modules/onboarding/onboarding.service.ts` (+ `onboarding.test.ts`): llamada en los dos caminos.
- `apps/api/docs/adr/ADR.md`: fila de cuota en ADR-010 y nota en ADR-008.

### Endpoints

| Método | Ruta             | Guardas                                       | Entrada                         | Salida                                                                                       |
| ------ | ---------------- | --------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/v1/onboarding` | Sin cambios (Turnstile, cuota por IP, `auth`) | Sin cambios (`OnboardingInput`) | Sin cambios; además, con correo ya registrado se encola `account-exists` (sujeto a su cuota) |

### Datos

- Sin tablas ni migraciones: la cuota usa `rate_counters` y el Cron diario ya limpia sus filas vencidas.

### Variables de entorno y bindings

- Ninguna. Usa `JOBS`, `DB` y `WEB_ORIGIN`, que ya existen.

### Pruebas requeridas

- [ ] Onboarding sin sesión con un correo ya registrado → `409 CONFLICT` con el mismo cuerpo que en T20 y un `email.send` `account-exists` encolado a ese correo, con `signInUrl` = `${WEB_ORIGIN}/entrar` y `resetUrl` = `${WEB_ORIGIN}/restablecer`, sin token.
- [ ] Misma `Idempotency-Key` y mismo cuerpo sin sesión → mismo `409` y el mismo aviso.
- [ ] Segundo intento dentro de la misma hora → `409` idéntico sin encolar. El cuarto intento del día tampoco encola.
- [ ] Cuenta con `email_status = 'undeliverable'` → `409` sin encolar.
- [ ] Falla al encolar → la respuesta sigue siendo `409 CONFLICT` (no `500`) y se registra `email.enqueue_failed`.
- [ ] Correo nuevo → solo se encola `verify-email`, nunca `account-exists`.
- [ ] Turnstile inválido, cuota por IP excedida o correo desechable → no se encola ningún aviso (esos rechazos ocurren antes).
- [ ] `EmailSendJob` rechaza un `account-exists` sin `signInUrl` o con campos extra; el consumidor lo manda a la DLQ sin reintento.
- [ ] La plantilla renderiza asunto, texto y HTML en español sin datos del intento. Los logs no contienen el correo.

### Criterios de aceptación

- [ ] En local (`pnpm --filter api dev`), un segundo `POST /v1/onboarding` con un correo ya registrado imprime en la terminal el aviso con los enlaces a `/entrar` y `/restablecer`. La respuesta HTTP es la misma que antes de esta task.
- [ ] `pnpm --filter api check`, `lint` y `test` pasan; `docs/api/openapi.json` no cambia (si cambia, solo en la descripción del 409).

### Notas

- **Por qué no se cambia el mensaje del `409`.** El texto «Ya tienes una cuenta con este correo. Entra para publicar tu menú.» no dice que se envió un correo. Así sigue siendo cierto aunque la cuota impida el aviso, y WEB no depende de esta task.
- **Por qué esa cuota.** Es más estricta que el reenvío de verificación (1 cada 60 s, 5 por día) porque el destinatario no pidió el correo. Un tercero que conoce un correo solo puede provocar 3 avisos al día. Turnstile y la cuota de 3 altas por IP ya acotan el volumen total.
- **Prerrequisito para salir a producción:** el dominio emisor de Resend dado de alta (pendiente de T08). Sin él, el aviso se encola y el consumidor lo reintenta hasta la DLQ, como cualquier otro correo.
