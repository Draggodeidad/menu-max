# MenusMax — Plan del backend (apps/api)

Nov 11, 2026 · @Imanol Antonio

## Resumen y principios

El backend es **un solo Worker Hono privado** (`apps/api`), alcanzable solo desde `apps/web` por Service Binding, con D1 + Drizzle como fuente de verdad, Zod como contrato único y Better Auth solo para identidad. Multi-tenant, RBAC y ABAC se resuelven con código propio pequeño: un `TenantContext` obligatorio en cada repositorio y una función `can()` pura. Nada de microservicios, motores de políticas ni contenedores de inyección.

Lectura en un minuto:

- **Seguridad por defecto:** la API no tiene ruta pública; toda entrada se valida con Zod estricto; todo acceso privado pasa por sesión → membresía → permiso (RBAC) → política sobre el recurso (ABAC).
- **Correo real:** la única prueba de que un correo existe es que el dueño haga clic en el enlace que le mandamos. Antes de enviar, filtramos sintaxis, dominios desechables y dominios sin MX para no quemar reputación.
- **Valor antes que cuenta se respeta:** el dueño publica y hace su pedido de prueba sin verificar; los pedidos de comensales reales y los avisos por WhatsApp se activan al verificar el correo.
- **Anti-spam en capas:** Turnstile + rate limit de Cloudflare como filtro grueso, cuotas exactas en D1 donde importa (reenvíos de correo, pedidos por teléfono).
- **Escala con lo que da Cloudflare:** Workers sin estado, caché del menú público, lecturas baratas; el único cuello de botella real es D1 y está aislado detrás de los repositorios.
- **Docs de API solo en desarrollo:** OpenAPI generado desde los mismos esquemas Zod, servido con Scalar únicamente cuando `ENVIRONMENT=development`.

Reglas anti-sobreingeniería (si una tarea las rompe, necesita ADR):

1. Un solo Worker API y **una sola cola** con mensajes tipados + DLQ.
2. Sin capas vacías: `routes` → `service` → `repository`; el `controller` no existe.
3. Sin librerías de autorización (CASL, Casbin): una tabla de permisos y políticas en TypeScript.
4. Sin Durable Objects, KV ni Workflows en el MVP; el README ya los deja para después.
5. Sin interfaces genéricas de repositorio ni base classes: funciones que reciben `db` y `tenant`.
6. Una abstracción se permite solo donde el proveedor puede cambiar: correo, WhatsApp y auth.

## Decisiones de stack

Cada fila es un ADR corto para `docs/adr/`; las marcadas como _beta_ llevan un adaptador para poder cambiar de proveedor sin tocar dominios.

| Pieza              | Elección                                                                       | Por qué                                                                                                                                                       | Alternativa descartada                                                     |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| HTTP               | Hono 4 en Workers                                                              | Ligero, tipado, middlewares oficiales (`secure-headers`, `body-limit`, `request-id`)                                                                          | Itty, NestJS (no corre bien en Workers)                                    |
| Datos              | D1 + Drizzle (`drizzle-orm/d1`)                                                | SQL tipado, migraciones con `drizzle-kit`, `db.batch()` para atomicidad                                                                                       | Prisma (bundle y cold start)                                               |
| Validación         | Zod v4 en `packages/contracts`                                                 | Un esquema = validación + tipos + OpenAPI; v4 es Standard Schema                                                                                              | Valibot (menos ecosistema en el equipo)                                    |
| Identidad          | Better Auth (email + contraseña, verificación, reset, sesiones en D1)          | Funciona con Drizzle sobre D1 en Workers ([ver guía](https://www.answeroverflow.com/m/1315488348118454282)); evita escribir hashing, tokens y sesiones a mano | Auth propio (más superficie de error), Lucia (ya no es librería mantenida) |
| Tenancy y permisos | Código propio (`modules/organizations`, `shared/authz`)                        | Necesitamos ABAC por sucursal y límites de plan; el plugin de organizaciones de Better Auth duplicaría la fuente de verdad                                    | Plugin `organization` de Better Auth                                       |
| Correo             | Cloudflare Email Service con binding `send_email` detrás de un puerto `Mailer` | Sin API keys, mismo proveedor; requiere Workers Paid y está en **beta** ([docs](https://developers.cloudflare.com/email-service/))                            | Resend o Amazon SES como respaldo si la beta limita                        |
| Anti-bots          | Turnstile + binding `ratelimits` + cuotas en D1                                | Nativo y sin costo extra                                                                                                                                      | Durable Objects para rate limit exacto (posterior)                         |
| Asíncrono          | Una cola `jobs` + DLQ + Cron para el relay del outbox                          | Reintentos y desacople de Meta y del correo                                                                                                                   | Una cola por tipo de mensaje                                               |
| Docs API           | `hono-openapi` + `@scalar/hono-api-reference`, solo en dev                     | Genera OpenAPI desde Zod v4 sin reescribir rutas ([hono.dev](https://hono.dev/examples/hono-openapi))                                                         | `@hono/zod-openapi` (obliga a reescribir cada ruta con `createRoute`)      |
| Pruebas            | Vitest + `@cloudflare/vitest-pool-workers`                                     | D1, Queues y R2 reales en Miniflare                                                                                                                           | Mocks de D1 a mano                                                         |

Plan de Cloudflare: **Workers Paid** desde el día uno. Lo exigen Email Service, el tiempo de CPU del hashing de contraseñas y el límite de 10 GB por base D1 (500 MB en Free) según los [límites de D1](https://developers.cloudflare.com/d1/platform/limits/).

Dependencias de `apps/api` en producción: `hono`, `drizzle-orm`, `zod`, `better-auth`, `hono-openapi`. Desarrollo: `wrangler`, `drizzle-kit`, `vitest`, `@cloudflare/vitest-pool-workers`, `@scalar/hono-api-reference`. Cualquier otra requiere ADR, igual que en el frontend.

## Estructura de `apps/api`

Cada módulo tiene tres archivos obligatorios (`routes`, `service`, `repository`) y nada más hasta que haga falta; los módulos se crean cuando su fase empieza, no antes.

```text
apps/api/
├── wrangler.jsonc            # DB, MEDIA, JOBS, EMAIL, ratelimits, crons; workers_dev: false
├── .dev.vars.example         # espejo de .env.example (secretos locales)
└── src/
    ├── index.ts              # export default { fetch, queue, scheduled }
    ├── app.ts                # crea Hono, registra middlewares y módulos
    ├── env.ts                # esquema Zod de bindings y secretos, validado una vez
    ├── docs.ts               # OpenAPI + Scalar, solo se registra en development
    ├── middleware/
    │   ├── internal.ts       # verifica que la llamada viene de WEB
    │   ├── session.ts        # resuelve user/session con Better Auth
    │   ├── tenant.ts         # requireMembership(orgId) → TenantContext
    │   └── rate-limit.ts     # filtro grueso por IP + grupo de rutas
    ├── shared/
    │   ├── authz/            # permissions.ts (RBAC) + policies.ts (ABAC) + can()
    │   ├── errors.ts         # AppError + catálogo de códigos
    │   ├── ids.ts            # UUIDv7, tokens públicos y su hash
    │   ├── log.ts            # logger JSON con redacción de PII
    │   └── money.ts
    ├── infrastructure/
    │   ├── db.ts             # drizzle(env.DB, { schema })
    │   ├── mailer/           # puerto Mailer + adaptador Cloudflare Email Service
    │   ├── turnstile.ts
    │   ├── storage.ts        # R2
    │   └── jobs.ts           # productor y consumidor de la cola
    └── modules/
        ├── auth/             # Better Auth montado en /v1/auth/*
        ├── onboarding/       # POST que crea org + negocio + sucursal + menú
        ├── organizations/    # miembros, invitaciones, roles
        ├── businesses/       # negocio, sucursales, horarios, zonas
        ├── catalog/
        ├── storefront/       # lectura pública + tema + publicación
        ├── orders/
        ├── notifications/    # outbox + WhatsApp
        └── subscriptions/    # planes y límites

packages/
├── contracts/                # Zod: requests, responses, errores, mensajes de cola
└── database/                 # esquema Drizzle (incluye tablas de Better Auth) + migraciones
```

Reglas entre capas:

1. **Routes** validan con Zod, leen `c.var` (usuario, tenant) y llaman a un servicio. No tocan `db`.
2. **Services** aplican políticas ABAC, reglas de negocio y deciden qué escribir. Reciben `{ db, tenant, actor }` como argumentos, no los leen de un global.
3. **Repositories** son funciones con SQL de Drizzle. Toda función de un recurso de tenant recibe `tenant.orgId` y lo pone en el `where`.
4. Un módulo llama al **servicio** de otro, nunca a su repositorio. Ejemplo: `orders.service` pide precios a `catalog.service.getPricedItems()`.
5. Las respuestas salen por un mapper a DTO de `contracts`; jamás se devuelve una fila de la base tal cual.
6. `packages/contracts` no importa nada de Workers ni de Drizzle: lo consume el frontend.

## Pipeline de una petición

El orden de los middlewares es parte del diseño de seguridad: lo barato y lo que rechaza más tráfico va primero, y nada toca D1 antes de pasar el filtro de origen y el rate limit.

1. **requestId** — toma `x-request-id` que manda WEB o genera uno; se agrega a cada log y a cada error.
2. **Origen interno** — la API exige el header `x-mm-internal` con un secreto compartido (`INTERNAL_TOKEN`), comparado en tiempo constante. Es el cinturón: el tirante es que la API no tiene ruta pública (`workers_dev: false`, sin `routes`).
3. **Contexto del cliente** — WEB reenvía la IP real (`x-client-ip`, tomada de `CF-Connecting-IP`) y el `user-agent`. La API solo confía en ellos porque el paso 2 pasó.
4. **Límites de cuerpo** — `bodyLimit` de 64 KB en JSON; las subidas de imagen tienen su propia ruta con 5 MB.
5. **Rate limit grueso** — binding `ratelimits` con llave `ip + grupo de ruta` (auth, público, privado). Responde 429 con `Retry-After`.
6. **Sesión** — Better Auth lee la cookie reenviada y deja `c.var.user` y `c.var.session` (o `null`).
7. **Guardas por ruta** — en este orden: `requireAuth` → `requireMembership(orgId)` → `requirePermission('catalog:write')`. La membresía se carga una vez por petición.
8. **Validación** — `validator('param' | 'query' | 'json', schema)` con esquemas de `contracts`.
9. **Handler → servicio → repositorio** — aquí se evalúa ABAC con el recurso ya cargado.
10. **onError global** — `AppError` sale como `{ code, message, requestId, fieldErrors? }`; errores de Zod salen como `VALIDATION_FAILED`; todo lo demás, `500 INTERNAL` genérico con el detalle solo en el log.

Cómo viaja la sesión entre Workers:

- La cookie vive en el dominio de WEB (`httpOnly`, `secure`, `sameSite=lax`). El navegador nunca habla con la API.
- `$lib/server/api.ts` reenvía el header `cookie` tal cual y devuelve al navegador los `set-cookie` que responde Better Auth.
- `trustedOrigins` de Better Auth = el origen de WEB; WEB reenvía `origin` para que su chequeo CSRF siga funcionando. SvelteKit mantiene `csrf.checkOrigin` en sus form actions.
- Cuando exista app móvil, se agrega una ruta pública con tokens bearer. No antes.

## Autenticación y verificación de correo

Un correo solo se considera real cuando su dueño hace clic en el enlace que le enviamos; todo lo anterior a eso son filtros para no enviar a direcciones basura. La verificación no bloquea el inicio de sesión: bloquea lo que expone el negocio al público.

### Estados de la cuenta y qué permite cada uno

| Estado                | Cómo se llega                        | Puede                                                           | No puede                                                          |
| --------------------- | ------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Sin verificar         | Envía `/crear` con éxito             | Entrar al panel, editar menú, ver QR, hacer el pedido de prueba | Recibir pedidos de comensales, activar WhatsApp, invitar miembros |
| Verificada            | Clic en el enlace (24 h de vigencia) | Todo según su rol                                               | —                                                                 |
| Sin verificar vencida | 7 días sin verificar                 | Entrar y pedir reenvío                                          | Su menú público muestra "Este menú aún no está activo"            |
| Suspendida            | Acción de plataforma (abuso)         | Nada; sesiones revocadas                                        | —                                                                 |

Así se respeta "valor antes que cuenta" de DESIGN.md: publicar y probar no esperan al correo, pero un bot que crea cuentas no obtiene un menú que recibe pedidos ni manda WhatsApp.

### Configuración de Better Auth

- `emailAndPassword.enabled: true`, `requireEmailVerification: false` (la regla vive en nuestras políticas como atributo `user.emailVerified`).
- `emailVerification.sendOnSignUp: true`, `autoSignInAfterVerification: true`, vigencia del token 24 h.
- `sendVerificationEmail` y `sendResetPassword` **no envían**: encolan un mensaje `email.send` en `JOBS` y regresan. La petición no espera al proveedor.
- Contraseña: mínimo 10 caracteres, máximo 128; plugin `haveIBeenPwned` para rechazar contraseñas filtradas (consulta por k-anonimato, no envía la contraseña).
- Sesiones en D1, 7 días con renovación diaria; al cambiar o restablecer contraseña se revocan todas las demás.
- Se instancia **por petición** con `createAuth(env)`, porque en Workers los bindings llegan en cada request.

### Filtros antes de enviar un correo

1. **Sintaxis y normalización** con Zod: `trim`, minúsculas, máximo 254 caracteres.
2. **Dominios desechables**: lista estática en el bundle (p. ej. `mailinator.com`), actualizada por script mensual. Respuesta: "Usa un correo que revises seguido."
3. **MX del dominio**: consulta DNS-over-HTTPS a `cloudflare-dns.com`, con el resultado guardado 24 h en la tabla `email_domain_checks` de D1. Dominio sin MX ni A → rechazo antes de crear la cuenta.
4. **No se hace sondeo SMTP** (`RCPT TO`): no es confiable y daña la reputación del dominio emisor.
5. **Rebotes**: si el proveedor reporta rebote duro o queja, se marca `email_status = 'undeliverable'` y se deja de enviar a esa dirección. _Pendiente confirmar qué eventos expone Email Service en beta._

### Protecciones del flujo

- **Sin enumeración:** "olvidé mi contraseña" y "reenviar verificación" siempre responden "Si el correo existe, te enviamos un enlace". El registro con correo ya existente manda un aviso a ese correo en vez de revelar que existe.
- **Reenvío de verificación:** 1 cada 60 s y 5 al día por cuenta (cuota exacta en D1).
- **Correos transaccionales** desde `no-responder@<dominio>`, con SPF, DKIM y DMARC del dominio onboardeado en Email Service; texto plano + HTML; sin tracking de aperturas.

### Onboarding en un solo envío (`POST /v1/onboarding`)

DESIGN.md pide que "Publicar menú" cree todo de una vez. D1 no tiene transacciones interactivas y Better Auth escribe el usuario por su cuenta, así que el flujo es en dos escrituras, idempotente:

1. Turnstile + filtros de correo → `auth.api.signUpEmail` crea usuario y sesión.
2. Un solo `db.batch()` crea organización, membresía `owner`, negocio, sucursal, menú, categoría y productos.
3. Si el paso 2 falla, el usuario ya tiene sesión y `/app` detecta "sin organización" y reintenta con el borrador de `localStorage` y la misma clave de idempotencia.

## Anti-spam y anti-abuso

Se usan tres capas porque ninguna sola basta: el binding de rate limit de Workers cuenta por ubicación de Cloudflare y solo admite ventanas de 10 o 60 s ([docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)), así que sirve como filtro grueso, no como cuota exacta.

| Capa                    | Dónde                                                                    | Para qué                                                                                | Costo                       |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------- |
| WAF rate limiting rules | Zona de WEB (`POST /entrar`, `/crear`, `/m/*/pedido`)                    | Cortar ráfagas antes de ejecutar un Worker                                              | Incluido según plan de zona |
| Turnstile               | Registro, reset de contraseña, crear pedido público; login tras 3 fallos | Probar que hay un humano; el token se valida en la API con `siteverify`, de un solo uso | Gratis                      |
| Binding `ratelimits`    | API, llave `ip + grupo`                                                  | Frenar scripts en caliente                                                              | Sin cargo extra             |
| Cuotas exactas en D1    | API, por cuenta, correo, teléfono o sucursal                             | Reglas de negocio que no pueden fallar                                                  | Una lectura indexada        |
| Honeypot                | Formularios públicos                                                     | Bots simples sin JS                                                                     | Nulo                        |

Cuotas exactas propuestas (ajustables por ADR):

| Acción                 | Límite                                   | Llave                           |
| ---------------------- | ---------------------------------------- | ------------------------------- |
| Crear cuenta           | 3 por día                                | IP                              |
| Reenviar verificación  | 1 cada 60 s, 5 por día                   | Usuario                         |
| Restablecer contraseña | 3 por hora                               | Correo normalizado              |
| Login fallido          | 5 en 15 min, luego Turnstile obligatorio | Correo + IP                     |
| Pedido público         | 3 en 10 min                              | Teléfono normalizado + sucursal |
| Pedido público         | 30 por hora                              | IP                              |
| Invitaciones           | 20 por día                               | Organización                    |

Implementación mínima de cuotas: una tabla `rate_counters (key, window_start, count)` con upsert atómico (`INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`) y limpieza por Cron diaria. Donde ya existe el dato (pedidos por teléfono), se cuenta sobre la tabla real con su índice.

Abuso de pedidos, además de lo anterior:

- Máximo 50 líneas por pedido y 99 unidades por línea; total máximo configurable por sucursal.
- La sucursal debe estar abierta, la modalidad activa y la zona atendida; si no, `422` con mensaje accionable.
- Las cuentas sin verificar no reciben pedidos públicos (sección de autenticación).
- Bloqueo de teléfono por negocio queda para después del piloto; la columna `customer_phone_hash` ya permite agregarlo.

## Multi-tenancy y aislamiento

Una sola base D1 compartida, con `organization_id` en cada tabla de negocio y un `TenantContext` que el compilador obliga a pasar: es el modelo más simple que aísla bien y el que menos cuesta operar en el MVP.

Modelo (sin cambios respecto al README): `organization` es el tenant, `business` la marca, `branch` la ubicación. Un usuario puede tener varias membresías.

Cómo se resuelve el tenant en cada petición:

1. Las rutas privadas llevan el tenant en la ruta: `/v1/orgs/:orgId/...` y, si aplica, `/branches/:branchId/...`.
2. `requireMembership` busca `organization_members` por `(orgId, userId)` con estado `active`. Si no existe, responde **404**, no 403, para no confirmar que la organización existe.
3. Construye `TenantContext = { orgId, memberId, role, branchIds, plan }` y lo deja en `c.var.tenant`.
4. Si la ruta lleva `branchId`, se verifica que la sucursal pertenezca a `orgId` antes de seguir.

Reglas que no se negocian:

- Ningún repositorio de tenant existe sin `tenant` como primer argumento; un lint con `eslint-plugin-drizzle` (`enforce-delete-with-where`, `enforce-update-with-where`) evita `update`/`delete` sin `where`.
- Toda búsqueda por id de recurso es `where org_id = ? and id = ?`. Un id válido de otra organización devuelve 404.
- Ids no secuenciales (UUIDv7) en todo; el número visible del pedido (`#1042`) es un contador por sucursal y nunca sirve para consultar.
- Lo público (`/v1/public/*`) se resuelve por `slug` o por token, y solo lee columnas publicables mediante consultas dedicadas, no reutilizando las del panel.
- Los índices compuestos empiezan por `organization_id` para que filtrar por tenant sea siempre barato.
- Cada endpoint privado tiene una prueba "org B intenta leer y modificar recursos de org A" que espera 404 (sección de pruebas).

Cuándo dejaríamos de compartir base: si una organización supera \~1 GB o genera más de 30 % de las escrituras. Como los repositorios reciben `db` desde el contexto, mover un tenant a su propia D1 es un cambio en la resolución del binding, no en los dominios.

## Autorización: RBAC + ABAC

RBAC responde "¿este rol puede hacer esta acción?" en el middleware, sin tocar la base; ABAC responde "¿puede hacerla sobre _este_ recurso, ahora?" en el servicio, con el recurso ya cargado. Ambas viven en `shared/authz` como código puro y probado con tablas.

### RBAC: permisos por rol

| Permiso                                               | owner | admin        | staff                    |
| ----------------------------------------------------- | ----- | ------------ | ------------------------ |
| `orders:read`                                         | Sí    | Sí           | Solo sus sucursales      |
| `orders:transition`                                   | Sí    | Sí           | Solo sus sucursales      |
| `orders:cancel`                                       | Sí    | Sí           | No                       |
| `catalog:write`                                       | Sí    | Sí           | No (solo disponibilidad) |
| `catalog:availability`                                | Sí    | Sí           | Sí                       |
| `storefront:publish`                                  | Sí    | Sí           | No                       |
| `settings:write` (horarios, zonas, modalidades, tema) | Sí    | Sí           | No                       |
| `branches:manage`                                     | Sí    | Sí           | No                       |
| `members:manage`                                      | Sí    | Solo `staff` | No                       |
| `subscription:read`                                   | Sí    | No           | No                       |
| `organization:delete`                                 | Sí    | No           | No                       |

```ts
// shared/authz/permissions.ts — la única fuente de verdad de RBAC
export const ROLE_PERMISSIONS = {
  owner: ["*"],
  admin: [
    "orders:read",
    "orders:transition",
    "orders:cancel",
    "catalog:write",
    "catalog:availability",
    "storefront:publish",
    "settings:write",
    "branches:manage",
    "members:manage",
  ],
  staff: ["orders:read", "orders:transition", "catalog:availability"],
} as const satisfies Record<Role, readonly Permission[]>;
```

### ABAC: atributos que se evalúan

| Atributo                      | Fuente                    | Regla de ejemplo                                                        |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `actor.emailVerified`         | Sesión                    | Sin verificar no publica para comensales, no activa WhatsApp, no invita |
| `tenant.branchIds`            | `member_branches`         | `staff` solo ve y mueve pedidos de sus sucursales                       |
| `resource.orgId` / `branchId` | Recurso cargado           | Debe coincidir con el tenant; si no, 404                                |
| `resource.status`             | Pedido                    | Solo transiciones válidas de la máquina de estados                      |
| `resource.version`            | Pedido, producto          | Escritura condicional; si cambió, `409 CONFLICT`                        |
| `target.role`                 | Miembro afectado          | `admin` no puede tocar a un `owner`; no se elimina al último `owner`    |
| `org.plan` y uso              | `subscriptions` + conteos | Bloquea crear sucursal o producto sobre el límite: `PLAN_LIMIT_REACHED` |
| `branch.isOpen(now)`          | Horarios                  | Pedido público solo con la sucursal abierta                             |

```ts
// shared/authz/policies.ts — funciones puras, sin I/O
export function canTransitionOrder(t: TenantContext, order: OrderAuthView, to: OrderStatus) {
  if (order.orgId !== t.orgId) return deny("NOT_FOUND");
  if (t.role === "staff" && !t.branchIds.includes(order.branchId)) return deny("NOT_FOUND");
  if (!ORDER_TRANSITIONS[order.status].includes(to)) return deny("INVALID_TRANSITION");
  if (to === "cancelled" && !hasPermission(t.role, "orders:cancel")) return deny("FORBIDDEN");
  return allow();
}
```

Reglas de uso:

- Cada ruta privada declara su permiso RBAC; una prueba recorre todas las rutas registradas y falla si alguna no tiene guarda.
- Cada servicio que modifica un recurso llama a su política antes del `batch`. Las políticas reciben vistas mínimas (`OrderAuthView`), no la fila completa.
- Las consultas de lista aplican el mismo filtro que la política (`staff` → `where branch_id in (...)`), para no filtrar en memoria.
- Roles personalizados por negocio quedan fuera del MVP; la tabla de permisos permite agregarlos sin cambiar las políticas.

## Modelo de datos y convenciones Drizzle/D1

El MVP arranca con menos tablas que el README: un menú por sucursal, productos que cuelgan directo de su categoría y sin `menu_products`. Se agregan cuando un negocio real pida compartir productos entre menús.

| Dominio                 | Tablas del MVP                                                                    | Notas                                                                   |
| ----------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Identidad (Better Auth) | `users`, `sessions`, `accounts`, `verifications`                                  | Generadas con su CLI hacia el esquema Drizzle; agregamos `email_status` |
| Tenancy                 | `organizations`, `organization_members`, `member_branches`, `invitations`         | Invitación con token hasheado, 7 días, un solo uso                      |
| Negocio                 | `businesses`, `branches`, `business_hours`, `delivery_zones`                      | Modalidades como columnas booleanas en `branches`                       |
| Catálogo                | `menus`, `categories`, `products`, `product_variants`, `option_groups`, `options` | `version` para concurrencia; borrado lógico                             |
| Storefront              | `storefront_themes`                                                               | JSON validado por Zod (presets, colores, fuente)                        |
| Media                   | `media_assets`                                                                    | Metadatos; el binario vive en R2                                        |
| Pedidos                 | `orders`, `order_items`, `order_status_history`, `idempotency_keys`               | Snapshot de precios y nombres en `order_items`                          |
| Mensajería              | `notification_outbox`, `notification_deliveries`                                  | Llave de deduplicación única                                            |
| Planes                  | `plans`, `subscriptions`                                                          | Límites como columnas del plan                                          |
| Operación               | `audit_logs`, `rate_counters`                                                     | Auditoría sin PII innecesaria                                           |

Convenciones:

- **Ids:** `text` con UUIDv7 (ordenable, buen índice). Tokens públicos (seguimiento, invitación): 32 bytes aleatorios en base64url; en la base solo se guarda su SHA-256.
- **Tiempo:** `integer` en milisegundos UTC (`created_at`, `updated_at`). La zona horaria vive en `branches.timezone` (`America/Mexico_City` por defecto).
- **Dinero:** enteros en centavos + `currency` (`MXN`). Nunca `real`.
- **Enums:** `text` con `CHECK` generado desde la misma constante de `contracts`.
- **Borrado:** lógico (`deleted_at`) en catálogo; los pedidos nunca se borran; FKs con `ON DELETE RESTRICT` desde pedidos.
- **Índices:** `(organization_id, …)` primero; únicos `(organization_id, slug)` para negocios y `slug` global único para el storefront.
- **Atomicidad:** D1 no tiene transacciones interactivas, así que el servicio calcula todo primero y escribe en un solo `db.batch([...])`. Pedido + ítems + historial + outbox van en el mismo batch.
- **Concurrencia:** `update orders set status = ?, version = version + 1 where id = ? and org_id = ? and version = ?`; cero filas afectadas = `409`.
- **Migraciones:** `drizzle-kit generate` → revisión en PR → `wrangler d1 migrations apply` local y luego staging; producción solo desde CI. Cambios destructivos con _expand/contract_.
- **Respaldo:** Time Travel de D1 cubre 30 días en Workers Paid; antes del piloto se prueba una restauración completa y se documenta en `docs/runbooks/`.

## Validación con Zod y formato de errores

Un esquema Zod en `packages/contracts` valida la entrada en la API, valida el formulario en SvelteKit y genera el OpenAPI; nadie vuelve a escribir esa forma en otro lugar.

Reglas de esquemas:

- **Objetos estrictos** (`z.strictObject`) en toda entrada: una llave desconocida es `400`. Evita asignación masiva (`role`, `orgId`, `price` colados en el body).
- **El cliente nunca manda** `organizationId`, `price`, `total`, `status` ni `role` propio: el tenant sale de la ruta verificada y los importes los calcula la API.
- Strings con `trim()`, longitud máxima siempre, normalización NFC; correos en minúsculas; teléfonos a E.164 (`+52…`).
- Números de query con `z.coerce`; paginación por cursor (`cursor`, `limit` ≤ 100), nunca `offset` sin tope.
- Dinero como `z.int().nonnegative().max(10_000_000)` en centavos.
- Colores del tema con regex `#RRGGBB` y verificación de contraste AA en el servicio (DESIGN.md §3.2).
- **Respuestas** también tienen esquema; el mapper a DTO es el único que decide qué columnas salen.
- **Variables de entorno** validadas con Zod en `env.ts` la primera vez que se usan; cualquier variable nueva se agrega a `.env.example` y `.dev.vars.example`.

Formato de error (igual para todos los endpoints):

```json
{
  "code": "VALIDATION_FAILED",
  "message": "Revisa los campos marcados.",
  "requestId": "0193f2c4-...",
  "fieldErrors": { "phone": ["Escribe un teléfono de 10 dígitos."] }
}
```

| Código                 | HTTP | Cuándo                                        |
| ---------------------- | ---- | --------------------------------------------- |
| `VALIDATION_FAILED`    | 400  | Zod rechazó la entrada                        |
| `AUTH_REQUIRED`        | 401  | Sin sesión válida                             |
| `EMAIL_NOT_VERIFIED`   | 403  | La acción requiere correo verificado          |
| `FORBIDDEN`            | 403  | Rol sin permiso dentro de su propio tenant    |
| `NOT_FOUND`            | 404  | No existe o es de otro tenant                 |
| `CONFLICT`             | 409  | `version` desactualizada o slug tomado        |
| `IDEMPOTENCY_CONFLICT` | 409  | Misma llave con otro cuerpo                   |
| `INVALID_TRANSITION`   | 422  | Cambio de estado no permitido                 |
| `BUSINESS_RULE`        | 422  | Cerrado, zona no atendida, producto agotado   |
| `PLAN_LIMIT_REACHED`   | 402  | Superó el límite del plan                     |
| `RATE_LIMITED`         | 429  | Con `Retry-After`                             |
| `INTERNAL`             | 500  | Todo lo inesperado; el detalle solo va al log |

Los mensajes se escriben en español de México con el estilo de DESIGN.md §6: qué pasó y cómo arreglarlo.

## Documentación de la API (solo desarrollo)

La documentación se genera de los mismos esquemas Zod con `hono-openapi` y se sirve con Scalar en `GET /docs` y `GET /openapi.json`, pero esas rutas **solo se registran cuando `ENVIRONMENT === 'development'`**. En staging y producción no existen: responden 404 como cualquier ruta desconocida.

Doble candado:

1. **No se registran** fuera de desarrollo (no es un `if` dentro del handler, es que la ruta no existe).
2. **La API no es pública:** aunque alguien activara las rutas por error, solo WEB puede llamarla. En local, `wrangler dev` expone la API en `localhost:8787`, que es donde se abre `/docs`.

```ts
// src/app.ts
if (env.ENVIRONMENT === "development") {
  const { registerDocs } = await import("./docs");
  registerDocs(app); // /openapi.json + /docs (Scalar)
}
```

Qué se documenta:

- Cada ruta con `describeRoute({ tags, summary, responses })` y los esquemas de `contracts` como `resolver(schema)`.
- Los endpoints de Better Auth con su plugin `openAPI`, también solo en desarrollo.
- Ejemplos con datos ficticios ("Tacos El Güero"), nunca datos reales.

Uso en CI sin exponer nada: un script `pnpm --filter api openapi:export` genera `docs/api/openapi.json` en cada PR y compara contra `main`. Un cambio que rompe el contrato (campo eliminado, tipo cambiado) falla el check salvo que el PR diga `breaking-change`. Ese archivo también sirve de contexto para los agentes que trabajan en `apps/web`.

Una prueba verifica que con `ENVIRONMENT=production` las rutas `/docs` y `/openapi.json` devuelven 404.

## Procesos asíncronos

Una sola cola `jobs` con mensajes tipados (unión discriminada de Zod en `contracts`) y una DLQ `jobs-dlq`; el consumidor es el `queue()` del mismo Worker API. Dos caminos de entrada según cuánto cuesta perder el mensaje:

| Mensaje                                                                             | Cómo entra a la cola                                                 | Por qué                                                                  |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `email.send` (verificación, reset, invitación)                                      | `JOBS.send()` directo desde la petición                              | Si falla, el usuario pulsa "Reenviar"; un outbox aquí es sobreingeniería |
| `notification.whatsapp` (pedido nuevo, cambio de estado)                            | Outbox en D1, en el mismo `batch` que el pedido; un relay lo publica | Un pedido no puede quedarse sin aviso en silencio                        |
| `maintenance.*` (limpiar `rate_counters`, sesiones vencidas, cuentas sin verificar) | Cron diario                                                          | No depende de ninguna petición                                           |

Relay del outbox:

1. Después de crear el pedido, la petición intenta publicar con `ctx.waitUntil()` (optimización).
2. Un Cron cada minuto toma filas `pending` con más de 30 s, las publica y las marca `published` con escritura condicional.
3. Publicar dos veces es aceptable: el consumidor deduplica.

Consumidor:

- Valida el mensaje con Zod; un mensaje inválido va directo a la DLQ (no se reintenta).
- Deduplica con `notification_deliveries.dedupe_key` único (`orderId:event:recipient`).
- Llama al proveedor con timeout de 10 s. Error transitorio (5xx, timeout, 429) → `retry({ delaySeconds })` con backoff; error permanente (4xx de plantilla o número) → se registra y se hace `ack`.
- `max_retries: 5`; después, DLQ. Una ruta privada de plataforma permite reprocesar la DLQ a mano.
- Timeout después de que el proveedor ya aceptó: se marca `ambiguous` y no se reintenta automáticamente, para no duplicar el WhatsApp.

El puerto `Mailer` tiene una sola función, `send({ to, template, data })`. Las plantillas viven en código (texto plano + HTML simple), con asunto y textos en español de México. En desarrollo, el adaptador escribe el correo en consola y en `.wrangler/emails/` en vez de enviarlo.

## Seguridad transversal

Estos controles aplican a todos los módulos; cada uno tiene una prueba o un check de CI que lo sostiene.

| Control                   | Cómo                                                                                                                                                                           | Verificación                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Secretos                  | `wrangler secret put` por entorno; `.dev.vars` en `.gitignore`; nunca en `wrangler.jsonc`                                                                                      | `gitleaks` en CI                   |
| Entornos aislados         | D1, R2, cola y secretos distintos para dev, staging y producción                                                                                                               | Revisión de `wrangler.jsonc` en PR |
| Logs sin PII              | Logger JSON con `redact()`: correo `a***@dominio.com`, teléfono `***1234`, sin direcciones, tokens ni cookies                                                                  | Prueba unitaria del logger         |
| Pedido público            | Token de seguimiento de 32 bytes; se guarda su hash; la vista pública no incluye teléfono ni dirección completos                                                               | Prueba de respuesta                |
| Idempotencia              | `idempotency_keys (key, org_id, request_hash, response, expires_at)`; misma llave + mismo cuerpo = misma respuesta; otro cuerpo = `409`                                        | Prueba de doble envío              |
| Subidas a R2              | Solo JPEG, PNG y WebP, ≤ 5 MB; tipo verificado por _magic bytes_, no por el header; la API fija la llave `org/{orgId}/media/{uuidv7}`; se guarda el registro en `media_assets` | Prueba con archivo renombrado      |
| Sin SQL crudo con entrada | Solo query builder de Drizzle o `sql` con parámetros                                                                                                                           | Lint que prohíbe `sql.raw`         |
| Cabeceras                 | `secureHeaders()` y `Cache-Control: no-store` en toda respuesta privada                                                                                                        | Prueba de headers                  |
| Auditoría                 | `audit_logs` para login, cambio de contraseña, alta y baja de miembros, cambio de rol, publicación, cancelación y cambio de plan                                               | Prueba por evento                  |
| Dependencias              | `pnpm audit` y Renovate semanal; versiones fijadas con lockfile                                                                                                                | CI                                 |
| Datos personales          | Dirección y teléfono solo en el pedido; retención propuesta de 12 meses y luego anonimización por Cron                                                                         | Runbook + Cron                     |

Amenazas del README §14 y dónde se cubren: aislamiento entre tenants (multi-tenancy), precio manipulado (validación + recálculo), doble checkout (idempotencia), dos empleados en el mismo pedido (`version`), abuso anónimo (anti-spam), enumeración (UUIDv7 + 404), archivos (R2), webhooks falsos de Meta (firma `X-Hub-Signature-256` verificada en la fase de WhatsApp), caídas de proveedor (cola + DLQ).

## Escalabilidad y rendimiento

Los Workers escalan solos; el límite real es D1, porque cada base es un único Durable Object con una sola instancia primaria de escritura ([FAQ de límites](https://developers.cloudflare.com/d1/platform/limits/)). Por eso la estrategia es leer poco de D1, no agregar infraestructura.

En orden de aplicación; cada paso se activa solo cuando una métrica lo pide:

1. **Índices y `rows_read`** desde el día uno. Cada consulta nueva se revisa con el `meta.rows_read` que devuelve D1; un listado no puede escanear la tabla.
2. **Caché del menú público en WEB**, no en la API: la Cache API necesita un Worker con zona y la API no tiene ruta pública. WEB guarda la respuesta con llave `menu:{slug}:v{menuVersion}`; la API expone `menuVersion` en una lectura mínima, y publicar o editar lo incrementa, así que no hay purga manual. El TTL exacto se fija en el ADR de caché.
3. **Polling barato:** `GET …/orders?since=<updatedAt>` con `ETag`; sin cambios responde `304` y el panel sigue a 10 s como pide DESIGN.md.
4. **Sin N+1:** el catálogo se arma con 3 o 4 consultas en un `batch`, no una por categoría. Workers Paid permite 1000 consultas por invocación, pero apuntamos a menos de 10.
5. **Read replication + Sessions API** para lecturas públicas cuando la latencia fuera de México lo justifique. Escrituras y "leer lo que acabo de escribir" siguen en primaria.
6. **Sacar datos fríos:** auditoría antigua a R2 y métricas de visitas a Analytics Engine, para no crecer la base.
7. **Una D1 por tenant grande**, solo si un negocio domina el uso (ver multi-tenancy).

Presupuestos de rendimiento (medidos en staging con datos sintéticos de 1000 negocios):

| Ruta                                                      | p95 objetivo | D1 máximo   |
| --------------------------------------------------------- | ------------ | ----------- |
| `GET /v1/public/menus/:slug` (acierto en la caché de WEB) | 50 ms        | 0 consultas |
| `GET /v1/public/menus/:slug` (sin caché)                  | 150 ms       | 1 batch     |
| `POST /v1/public/orders`                                  | 300 ms       | 2 batches   |
| `GET …/orders` del panel                                  | 150 ms       | 1 batch     |

Costos que vigilar desde el piloto: lecturas y escrituras de D1, mensajes de cola, correos enviados y conversaciones de WhatsApp. Una alerta avisa si alguno crece más rápido que los pedidos.

## Pruebas, CI y definición de terminado

Las pruebas que más importan aquí no son de cobertura sino adversariales: un tenant contra otro, un rol contra una acción prohibida, el mismo pedido enviado dos veces.

| Tipo        | Herramienta                                                           | Qué cubre                                                                                                        |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unitarias   | Vitest                                                                | `can()` y políticas en tabla rol × acción × estado; máquina de estados; cálculo de totales; horarios; `redact()` |
| Integración | `@cloudflare/vitest-pool-workers` (D1, R2 y cola reales en Miniflare) | Endpoints completos, migraciones desde cero, atomicidad pedido + outbox, consumidor con proveedor simulado       |
| Aislamiento | Generador sobre todas las rutas registradas                           | Cada ruta privada con ids de otra org → 404; cada ruta sin sesión → 401; ninguna ruta sin guarda                 |
| Abuso       | Integración                                                           | Cuotas exactas, Turnstile inválido o reutilizado, llave de idempotencia repetida, `version` vieja                |
| Contrato    | Script de OpenAPI                                                     | Diff contra `main`; romper el contrato requiere etiqueta                                                         |

CI en cada PR (GitHub Actions): `lint` → `typecheck` → `test` → `drizzle-kit check` → diff de OpenAPI → `gitleaks` → `wrangler deploy --dry-run`. Despliegue: staging automático al fusionar en `main`; producción manual con migraciones primero y API antes que WEB.

Definición de terminado de cualquier task del backend:

- [ ] Esquemas nuevos en `packages/contracts`, estrictos, con esquema de respuesta.
- [ ] Cada ruta nueva tiene guarda RBAC, política ABAC si toca un recurso y prueba de aislamiento.
- [ ] Ningún repositorio de tenant sin `tenant.orgId` en el `where`.
- [ ] Errores con códigos del catálogo y mensajes en español de México.
- [ ] Variables de entorno nuevas en `.env.example` y `.dev.vars.example`.
- [ ] Migración generada y revisada, reversible o con plan _expand/contract_.
- [ ] Logs sin PII; nada sensible en respuestas públicas.
- [ ] `/docs` muestra la ruta nueva en local con ejemplo ficticio.
- [ ] Rama propia, commits pequeños y PR con descripción corta.

## Fases y tasks

Siete fases y 27 tasks; cada fase cierra con un criterio de aceptación verificable y ninguna empieza sin que la anterior lo cumpla. Las fases B4 a B6 corresponden a las fases 2 a 4 del README.

| Task | Entrega                                                                                                                           | Fase                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| T01  | `apps/api`, `wrangler.jsonc` por entorno (`workers_dev: false`), `env.ts` con Zod                                                 | B1 Fundación          |
| T02  | Middlewares base: requestId, origen interno, `secureHeaders`, `bodyLimit`, `onError` + catálogo de errores, logger con `redact()` | B1 Fundación          |
| T03  | `packages/contracts` y `packages/database` con Drizzle y primera migración                                                        | B1 Fundación          |
| T04  | Docs solo en dev (`hono-openapi` + Scalar), export de `openapi.json`, prueba de 404 en producción                                 | B1 Fundación          |
| T05  | CI: lint, typecheck, Vitest con pool de Workers, `gitleaks`, dry-run                                                              | B1 Fundación          |
| T06  | `$lib/server/api.ts` en WEB: Service Binding, reenvío de cookie y `set-cookie`, `x-client-ip`, `x-mm-internal`                    | B1 Fundación          |
| T07  | Better Auth con Drizzle sobre D1, tablas de identidad, sesiones                                                                   | B2 Identidad y correo |
| T08  | Cola `jobs` + DLQ + consumidor + puerto `Mailer` (Email Service y adaptador de consola)                                           | B2 Identidad y correo |
| T09  | Verificación de correo, reenvío con cuota, reset de contraseña, plantillas                                                        | B2 Identidad y correo |
| T10  | Filtros de correo (desechables, MX), Turnstile, binding `ratelimits`, `rate_counters`                                             | B2 Identidad y correo |
| T11  | Tablas de tenancy, `requireMembership`, `TenantContext`                                                                           | B3 Tenancy y permisos |
| T12  | `shared/authz` (RBAC + ABAC) y prueba "ninguna ruta sin guarda"                                                                   | B3 Tenancy y permisos |
| T13  | `POST /v1/onboarding` idempotente en dos escrituras                                                                               | B3 Tenancy y permisos |
| T14  | Invitaciones, miembros y asignación de sucursales a `staff`                                                                       | B3 Tenancy y permisos |
| T15  | Planes, límites y `PLAN_LIMIT_REACHED`                                                                                            | B3 Tenancy y permisos |
| T16  | Negocio, sucursales, horarios, modalidades y zonas                                                                                | B4 Catálogo y menú    |
| T17  | CRUD de catálogo con `version` y borrado lógico                                                                                   | B4 Catálogo y menú    |
| T18  | Subidas a R2 con validación de _magic bytes_ y `media_assets`                                                                     | B4 Catálogo y menú    |
| T19  | Tema con contraste AA, publicación, `menuVersion` y lectura pública                                                               | B4 Catálogo y menú    |
| T20  | QR en SVG por menú y por mesa                                                                                                     | B4 Catálogo y menú    |
| T21  | `POST /v1/public/orders`: Turnstile, cuotas, recálculo, idempotencia, batch con outbox                                            | B5 Pedidos            |
| T22  | Seguimiento por token                                                                                                             | B5 Pedidos            |
| T23  | Máquina de estados, transiciones con `version`, historial, polling con `since` y `ETag`                                           | B5 Pedidos            |
| T24  | Relay por Cron, consumidor de WhatsApp, deduplicación, reproceso de DLQ                                                           | B6 WhatsApp           |
| T25  | Webhook de estado de Meta con firma verificada                                                                                    | B6 WhatsApp           |
| T26  | Auditoría completa, retención de datos personales, Crons de mantenimiento                                                         | B7 Endurecimiento     |
| T27  | Carga con datos sintéticos, presupuestos de rendimiento, alertas, prueba de restauración de D1                                    | B7 Endurecimiento     |

&#91;embedded content: ruta del backend · 7 fases, cada una con su criterio de cierre\]

Las fases van en serie porque cada una usa lo que la anterior probó: sin aislamiento entre tenants (B3) no se abre el catálogo, y sin pedidos atómicos con outbox (B5) no tiene sentido WhatsApp.

## Decisiones pendientes y riesgos

Cinco decisiones bloquean tasks concretas y conviene cerrarlas como ADR antes de que su fase empiece.

| Decisión                                                | Opciones                                     | Recomendación                                       | Bloquea  |
| ------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- | -------- |
| Proveedor de correo mientras Email Service esté en beta | Email Service solo; Email Service + respaldo | Email Service con adaptador listo para Resend o SES | T08      |
| Gracia para cuentas sin verificar                       | 3, 7 o 14 días                               | 7 días y menú inactivo después                      | T09, T19 |
| Login tras fallos                                       | Turnstile siempre; tras 3 fallos             | Tras 3 fallos, para no frenar al dueño diario       | T10      |
| Retención de datos del comensal                         | 6, 12 o 24 meses                             | 12 meses y anonimización                            | T26      |
| TTL de la caché del menú en WEB                         | 60 s; 300 s con versión en la llave          | 300 s, porque la versión invalida al publicar       | T19      |

Riesgos:

- **Email Service en beta:** sus APIs y límites pueden cambiar y aún no está claro cómo reporta rebotes. Mitigación: el puerto `Mailer` y pruebas de entregabilidad a Gmail, Outlook y Yahoo antes del piloto.
- **Confianza en `x-client-ip`:** si la API llegara a tener ruta pública, cualquiera podría falsear la IP y saltarse cuotas. Mitigación: `INTERNAL_TOKEN` + revisión de `wrangler.jsonc` en cada PR.
- **Dos escrituras en el onboarding:** puede quedar un usuario sin organización. Mitigación: reanudación idempotente desde `/app`.
- **D1 como único punto de escritura:** un pico de pedidos (promoción en redes) se nota primero ahí. Mitigación: presupuestos de consultas y prueba de carga en B7.
- **Better Auth evoluciona rápido:** fijar versión exacta y revisar su changelog en cada actualización; su uso queda encapsulado en `modules/auth`.

### Fuentes

Consultadas el 2026-11-11.

- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) — beta, Workers Paid, binding `send_email`.
- [Email Service: Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) — ventanas de 10 o 60 s, límite por ubicación.
- [Límites de D1](https://developers.cloudflare.com/d1/platform/limits/) — 10 GB por base en Paid, 1000 consultas por invocación, Time Travel de 30 días.
- [Hono OpenAPI](https://hono.dev/examples/hono-openapi) y [Scalar para Hono](https://hono.dev/examples/scalar)
- [Better Auth con Drizzle y D1 en Workers](https://www.answeroverflow.com/m/1315488348118454282)
- `README (2).md`, `claude/DESIGN.md` y `claude/AGENTS.md` del proyecto MenusMax.
