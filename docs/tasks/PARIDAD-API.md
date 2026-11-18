# Paridad entre la API y el frontend

Auditoría del 2026-11-17 que cruza los contratos de `packages/contracts` y las rutas de `docs/api/openapi.json` contra las pantallas de `apps/web`. Es la base de las tasks 16 a 33.

## Regla

**La API es la única fuente de verdad y dicta el alcance del frontend.**

- Todo endpoint, campo, parámetro, validación y estado que la API ya soporta tiene su control en la interfaz y una task que lo conecta. Que no esté en el diseño actual no es motivo para dejarlo fuera: la task agrega el control y actualiza `apps/web/DESIGN.md`.
- Las validaciones de los formularios salen de los esquemas de `@menu-max/contracts`: límites, formatos y mensajes. La UI no inventa reglas más estrictas ni más laxas.
- Lo que la UI tiene y la API no soporta se adapta a la API. Si el backend lo tiene planeado en `apps/api/docs/STATUS.md` (pedidos, WhatsApp), sigue simulado hasta su task. Si no está planeado, se quita.
- Lo que falta en el contrato no se inventa en WEB: se pide al backend en su propio PR (ver «Pedidos al backend»).

## Matriz

Columnas: lo que soporta la API · lo que tiene la UI hoy · qué falta · task que lo cierra.

### Identidad y sesión

| API                                                                                                                      | UI hoy                                             | Brecha                                                                   | Task |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------ | ---- |
| `POST /v1/auth/sign-in/email` (`email`, `password`, `rememberMe?`)                                                       | `/entrar` con correo y contraseña; sesión simulada | Llamada real; casilla para `rememberMe`; `401` y `429` con `Retry-After` | 17   |
| `POST /v1/auth/sign-out`                                                                                                 | No existe                                          | Control «Salir»                                                          | 17   |
| `GET /v1/me` (`MeDto`: `emailVerified`, membresías)                                                                      | `demo_sesion`                                      | Sesión real en `hooks.server.ts`                                         | 17   |
| Varias membresías en `MeDto`; `GET /v1/orgs/{orgId}` (`OrganizationDto`)                                                 | Una organización fija                              | Selector de organización                                                 | 18   |
| `GET /v1/auth/verify-email`                                                                                              | No existe `/verificar-correo`                      | Pantalla nueva                                                           | 20   |
| `POST /v1/auth/send-verification-email` (cuota 1/60 s, 5/día)                                                            | No existe                                          | Aviso y reenvío en el panel                                              | 20   |
| `POST /v1/auth/request-password-reset` (Turnstile, 3/h) y `POST /v1/auth/reset-password` (`token`, `newPassword` 10–128) | «¿Olvidaste tu contraseña?» deshabilitado          | Pantalla `/restablecer` con sus dos estados                              | 21   |
| `POST /v1/auth/change-password` (`currentPassword`, `newPassword`; revoca otras sesiones)                                | No existe                                          | Sección «Cuenta» en ajustes                                              | 21   |
| `GET /v1/auth/get-session`, `GET /v1/health`                                                                             | —                                                  | Solo servidor: comprobación del binding                                  | 16   |

### Alta (`/crear`)

| API (`OnboardingInput`)                                                            | UI hoy                                | Brecha                                      | Task   |
| ---------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------- | ------ |
| `businessName` 1–120                                                               | 2–60                                  | Límites del contrato                        | 19     |
| `products[].name` 1–80; `priceCents` 0–10,000,000; tope = `max_products` de `free` | Nombre ≤ 60; precio > $0; tope de 15  | Límites del contrato; se acepta precio $0   | 19     |
| `modes` (al menos una)                                                             | Sí                                    | —                                           | 19     |
| `tableCount` 0–200, obligatorio con Mesa                                           | No existe                             | Campo «Mesas» al elegir Mesa                | 19     |
| `alertWhatsapp` E.164 opcional                                                     | 10 dígitos obligatorio                | E.164 con lada; opcional                    | 19     |
| `account.password` 10–128                                                          | ≥ 8                                   | Límites del contrato                        | 19     |
| Headers `Idempotency-Key` y `x-turnstile-token`                                    | No existen                            | Llave en campo oculto y widget de Turnstile | 16, 19 |
| `409 CONFLICT`, `409 IDEMPOTENCY_CONFLICT`, `429`, reanudación con sesión          | Solo `409` simulado (task-15)         | Los demás estados                           | 19     |
| `OnboardingDto` + `GET …/qr`                                                       | QR y enlace simulados en `/app/listo` | Datos reales                                | 19     |

### Organización, sucursales y permisos

| API                                                                                               | UI hoy                               | Brecha                                    | Task                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------- | ------------------------------- |
| `GET`, `POST /branches` (paginado; `402` al pasar `maxBranches`)                                  | Una sucursal implícita               | Selector de sucursal y «Agregar sucursal» | 18, 26                          |
| `PATCH /business` (`name` 1–120)                                                                  | No existe                            | Campo «Nombre del negocio»                | 26                              |
| `BranchDto.name`, `timezone` (IANA), `contactPhone` (E.164), `maxOrderTotalCents` (1–100,000,000) | No existen                           | Campos de la sucursal                     | 26                              |
| `BranchDto.alertWhatsapp` (E.164; capturarlo implica consentimiento)                              | No existe en ajustes                 | Campo con texto de consentimiento         | 26                              |
| `modes`, `tableCount`                                                                             | Modalidades en Servicio; mesas en QR | Conectar con `version`                    | 26                              |
| Matriz rol → permiso (ADR-007), `staff` limitado a sus sucursales                                 | Todo visible para todos              | Ocultar lo que el rol no permite          | 18 (requiere pedido al backend) |
| Suscripción `suspended`: toda escritura → `403` con `SUSPENDED_MESSAGE`                           | No existe                            | Modo solo lectura                         | 32                              |

### Horarios y zonas

| API                                                                                                    | UI hoy                   | Brecha                                                              | Task |
| ------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------- | ---- |
| `PUT /hours`: rangos por día (`weekday` 0–6, `HH:MM`, cruza medianoche, ≤ 50, vacío = siempre cerrado) | Una apertura y un cierre | Editor semanal con varios rangos por día                            | 27   |
| Zona: `name`, `postalCodes` (1–100, 5 dígitos, sin repetir), `feeCents` 0–1,000,000, `active`          | Nombre y costo           | Códigos postales, pausar, borrar; ≤ 20 zonas; repetidos entre zonas | 28   |

### Catálogo e imágenes

| API                                                                                                | UI hoy                                      | Brecha                                             | Task   |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- | ------ |
| `GET /menu` (`MenuDto`, con `version` por elemento)                                                | Catálogo simulado                           | Lectura real                                       | 23     |
| Categoría: crear, renombrar, borrar, reordenar (≤ 100)                                             | Crear, borrar, mover                        | Renombrar                                          | 23     |
| Producto: `name` 1–80, `description` ≤ 500, `priceCents` 0–10,000,000, `available`, `categoryId`   | Precio > $0 y disponible                    | Nombre, descripción, mover de categoría, precio $0 | 23     |
| `PUT /categories/{id}/products/order`                                                              | No existe                                   | Reordenar productos                                | 23     |
| `PATCH /availability` (`staff` puede)                                                              | Casilla «disponible»                        | Respetar el rol                                    | 23     |
| `variants`: `name` + `priceCents` propio, ≤ 20; reemplazan el precio del producto                  | «Opción» con «costo extra» y casilla activa | Editor de variantes con precio propio              | 24     |
| `optionGroups`: `name`, `minSelect`, `maxSelect`, `options` (`name`, `priceDeltaCents`), ≤ 10 × 30 | No existe                                   | Editor de grupos de opciones                       | 24     |
| `POST /media` (JPEG, PNG o WebP; ≤ 5 MB; ≤ 6000 px; 60/h) y `DELETE /media/{id}`                   | Foto simulada                               | Subir, cambiar y quitar                            | 25     |
| `imageAssetId`, `logoAssetId`, `coverAssetId`                                                      | Solo foto de producto                       | Logo y portada del menú                            | 25, 29 |

### Menú público, tema, publicación y QR

| API                                                                                                                                                              | UI hoy                                         | Brecha                                                    | Task   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- | ------ |
| Tema: `preset`, `primaryColor`, `backgroundColor`, `textColor` (`#RRGGBB`, contraste AA), `fontPreset`, `productLayout`, `logo`, `cover`, `showBranding`         | Preset, color primario y fuente                | Fondo, texto, acomodo, logo, portada, sello               | 29     |
| `features.customTheme` y `removeBranding` (`402` sin la capacidad)                                                                                               | No existe                                      | Controles deshabilitados con su motivo                    | 29, 32 |
| `POST /menu/publish`, `POST /menu/unpublish`, `PATCH /menu/slug` (solo antes de la primera publicación; `409` tomado; `422` ya publicado)                        | No existe                                      | Publicar, despublicar y elegir el enlace                  | 30     |
| `GET /qr` y `?mesa=n` (1–`tableCount`; `422` sin publicar)                                                                                                       | QR simulado                                    | QR real del menú y por mesa                               | 30     |
| `PublicMenuDto` completo: teléfono, horario de hoy, `isOpen`, `nextOpening`, zonas con tarifa, tema efectivo, descripción, variantes, grupos con mínimo y máximo | Menú simulado con una sola opción por producto | Mostrar todo; elegir variante y opciones según sus reglas | 33     |
| `GET /v1/public/menus/{slug}/version` (ADR-014)                                                                                                                  | No existe                                      | Caché por versión                                         | 33     |

### Equipo, plan e invitaciones

| API                                                                                                                                 | UI hoy                                   | Brecha                                            | Task |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------- | ---- |
| `GET /members` (paginado: nombre, correo, rol, `branchIds`)                                                                         | Lista simulada                           | Lista real con paginación                         | 31   |
| `PATCH /members/{id}` (`role`, `branchIds`), `DELETE` (último dueño → `422`)                                                        | Cambiar rol y quitar                     | Asignar sucursales al personal                    | 31   |
| `POST /invitations` (`email`, `role`, `branchIds` obligatorio para `staff`; `admin` solo invita `staff`; correo verificado; 20/día) | Correo y rol                             | Sucursales del personal; roles según quien invita | 31   |
| `GET /invitations` (`expired`, `expiresAt`) y `DELETE /invitations/{id}`                                                            | «Invitación pendiente» sin acciones      | Lista con vencimiento y «Cancelar invitación»     | 31   |
| `GET /v1/public/invitations/{token}` y `POST …/accept`                                                                              | Simulados (task-13)                      | Conectar; Turnstile                               | 22   |
| `GET /subscription`: plan, `status`, `currentPeriodEnd`, `limits`, `usage`, `features`                                              | Solo la fecha de fin de prueba (task-14) | Sección «Plan» con uso y límites                  | 32   |

### Lo que la UI tiene y la API no

| UI                                       | Estado en la API                                              | Qué se hace                                                     | Task |
| ---------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------- | ---- |
| «Tiempo promedio cocina» (ajustes)       | No existe ni está planeado                                    | Se quita                                                        | 26   |
| Activar o desactivar una variante        | No existe ni está planeado                                    | Se quita; la disponibilidad es del producto                     | 24   |
| «Costo extra» de una opción              | Es `priceDeltaCents` de un grupo de opciones, no una variante | Se mueve al editor de grupos                                    | 24   |
| Checkout, seguimiento y panel de pedidos | Backend T21–T23 pendientes                                    | Siguen simulados; los menús reales no aceptan pedidos hasta T21 | 33   |
| Avisos por WhatsApp                      | Backend T24–T25 pendientes                                    | Siguen simulados                                                | —    |

## Pedidos al backend

Cada uno va en su propio PR del backend, antes de la task que lo necesita:

1. **Matriz de permisos en el contrato** (bloquea a task-18). `ROLE_PERMISSIONS` vive en `apps/api/src/shared/authz/permissions.ts`, y WEB no puede importarlo. Se propone moverlo a `packages/contracts`: es un dato puro que la API sigue usando. Así WEB oculta lo que el rol no permite sin duplicar la matriz.
2. **Reservar el slug del negocio de ejemplo** (bloquea a task-33). `tacos-el-guero` no está en `RESERVED_SLUGS`, y un negocio real podría tomarlo.
3. **Aceptar el TTL de ADR-014** (bloquea la caché de task-33). Hoy está `Propuesto`.
4. **Capacidades del plan para quien edita sin `subscription:read`** (mejora task-29; no la bloquea). `admin` edita el tema, pero solo `owner` puede leer `features`. Se propone exponer `features` en `GET /v1/orgs/{orgId}` (`OrganizationDto`) o abrir `GET /subscription` en lectura a `admin`, sin el uso ni los límites. Mientras no exista, `admin` se entera por el `402`.
