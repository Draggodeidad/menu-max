# AGENTS.md — `apps/api` (backend MenusMax)

Instrucciones para cualquier agente de IA (Claude Code, Codex, Cursor, etc.) que trabaje en el backend de MenusMax. Aplica a `apps/api`, `packages/contracts` y `packages/database`. El frontend (`apps/web`) tiene sus propias reglas en `apps/web/AGENTS.md` y **no se toca desde aquí**.

---

## 0. Antes de escribir una sola línea

1. **Lee este archivo completo y `docs/adr/ADR.md`.** Los ADR con estado `Aceptado` son obligatorios. Si la tarea contradice uno, **detente y pregunta**; no improvises ni "mejores" la decisión por tu cuenta.
2. Lee `README.md` de la raíz para la arquitectura general (SvelteKit → Service Binding → Hono, D1, R2, Queues).
3. Lee la tarea en `docs/tasks/` y su fila en `docs/STATUS.md`.
4. Identifica antes de empezar: módulo(s), endpoints, tablas, permisos RBAC y políticas ABAC que toca.

Confirma en tu primer mensaje: **"Leí AGENTS.md y ADR.md"** y, en una línea, qué módulo, endpoints y tablas vas a tocar.

---

## 1. Stack y versiones

| Pieza          | Elección                                                                                |
| -------------- | --------------------------------------------------------------------------------------- |
| Runtime        | Cloudflare Workers (plan Workers Paid), `compatibility_date` fijada en `wrangler.jsonc` |
| Framework HTTP | Hono 4                                                                                  |
| Lenguaje       | TypeScript estricto (`strict`, `noUncheckedIndexedAccess`)                              |
| Validación     | Zod v4, esquemas en `packages/contracts`                                                |
| Base de datos  | Cloudflare D1 + Drizzle ORM (`drizzle-orm/d1`)                                          |
| Identidad      | Better Auth (email + contraseña, verificación, reset, sesiones en D1)                   |
| Archivos       | Cloudflare R2 (binding `MEDIA`)                                                         |
| Asíncrono      | Una cola `jobs` + DLQ `jobs-dlq` + Cron Triggers                                        |
| Correo         | Cloudflare Email Service (binding `EMAIL`) detrás del puerto `Mailer`                   |
| Anti-bots      | Turnstile + binding `ratelimits` + cuotas en D1                                         |
| Docs API       | `hono-openapi` + `@scalar/hono-api-reference`, **solo en desarrollo**                   |
| Pruebas        | Vitest + `@cloudflare/vitest-pool-workers`                                              |
| Gestor         | pnpm workspaces                                                                         |

**Dependencias permitidas en producción:** `hono`, `drizzle-orm`, `zod`, `better-auth`, `hono-openapi`.
**Dependencias permitidas en desarrollo:** `wrangler`, `drizzle-kit`, `vitest`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `@scalar/hono-api-reference`, `eslint-plugin-drizzle`.

Cualquier otra dependencia necesita un ADR aprobado antes de instalarla. Prohibido en particular:

- Otros ORMs o query builders (Prisma, Kysely directo, TypeORM).
- Librerías de autorización (CASL, Casbin, Oso) y contenedores de inyección (tsyringe, inversify).
- Librerías de JWT o hashing (`jsonwebtoken`, `bcrypt`, `argon2`): Better Auth ya lo resuelve.
- `axios`, `node-fetch`, `lodash`, `moment`, `dayjs` con plugins pesados: usa `fetch`, código nativo e `Intl`.
- Cualquier SDK que dependa de APIs de Node no soportadas en Workers.

---

## 2. Comandos

Desde la raíz del monorepo:

```bash
pnpm --filter api dev               # wrangler dev en http://localhost:8787 (/docs disponible)
pnpm --filter api check             # tsc --noEmit
pnpm --filter api lint              # eslint + prettier
pnpm --filter api test              # vitest (D1, R2 y cola locales)
pnpm --filter api openapi:export    # escribe docs/api/openapi.json
pnpm --filter database db:generate  # drizzle-kit generate (nueva migración)
pnpm --filter api db:migrate:local  # wrangler d1 migrations apply DB --local
```

> Si un script todavía no existe, créalo en la task que lo necesite (T01/T02) con exactamente ese nombre.

**Nunca ejecutes:** `wrangler deploy`, cualquier comando con `--remote`, `wrangler secret put`, `wrangler d1 execute` contra entornos remotos, ni borres estado local de `.wrangler/` que no creaste. Eso lo hace un humano o CI.

---

## 3. Estructura

```text
apps/api/
├── AGENTS.md
├── CLAUDE.md
├── wrangler.jsonc            # DB, MEDIA, JOBS, EMAIL, ratelimits, crons; workers_dev: false
├── .dev.vars.example
└── src/
    ├── index.ts              # export default { fetch, queue, scheduled }
    ├── app.ts                # crea Hono, middlewares en orden fijo, monta módulos
    ├── env.ts                # esquema Zod de bindings y secretos
    ├── docs.ts               # OpenAPI + Scalar (solo development)
    ├── middleware/           # request-id, internal, client-context, rate-limit, session,
    │                         # require-auth, tenant, authz
    ├── shared/               # authz/, errors.ts, ids.ts, log.ts, money.ts, rate-counters.ts,
    │                         # email-checks.ts, disposable-domains.ts, idempotency.ts, audit.ts
    ├── infrastructure/       # db.ts, mailer/, turnstile.ts, storage.ts, jobs.ts, whatsapp.ts
    ├── jobs/                 # consumer.ts + un handler por tipo de mensaje
    └── modules/
        └── <modulo>/
            ├── <modulo>.routes.ts
            ├── <modulo>.service.ts
            ├── <modulo>.repository.ts
            └── <modulo>.test.ts
apps/api/test/                # factories.ts, isolation.ts (helpers de pruebas)
apps/api/scripts/             # scripts de mantenimiento (p. ej. update-disposable-domains.ts)

packages/contracts/src/       # Zod: inputs, DTOs, errores, mensajes de cola, enums
packages/database/
├── src/schema/               # un archivo por dominio + auth.ts (Better Auth)
└── migrations/               # generadas por drizzle-kit
```

Reglas:

- **No crees carpetas ni archivos que la tarea no necesita.** Nada de `utils/`, `helpers/`, `common/`, `types/`, `constants/`, `controllers/`, `dto/` "por si acaso". `shared/` solo contiene lo listado arriba.
- Un módulo se crea cuando empieza su fase, no antes. Módulos previstos: `auth`, `onboarding`, `organizations`, `businesses`, `catalog`, `storefront`, `orders`, `notifications`, `subscriptions`.
- Los esquemas Zod viven en `packages/contracts`, no dentro del módulo. El frontend los importa desde ahí.
- `packages/contracts` **no importa** nada de Workers, Drizzle ni Hono.
- Un módulo llama al **servicio** de otro módulo, nunca a su repositorio.

---

## 4. Reglas no negociables

### Seguridad

- **La API es privada.** `workers_dev: false` y sin `routes` ni dominio propio. Agregar una ruta pública requiere ADR.
- **Toda petición pasa por `middleware/internal.ts`** (header `x-mm-internal` comparado en tiempo constante). La única excepción es `/docs` y `/openapi.json` en development (ADR-012); ni siquiera `/v1/health` se salta este middleware.
- **El cliente nunca decide:** `organizationId`, `branchId` sin verificar, `price`, `total`, `status`, `role` o `emailVerified`. El tenant sale de la ruta verificada por `requireMembership`; los importes los calcula el servicio.
- **Toda entrada se valida con Zod estricto** (`z.strictObject`). Toda respuesta sale por un mapper a DTO de `contracts`; nunca devuelvas una fila de Drizzle tal cual.
- **Recurso de otro tenant = `404 NOT_FOUND`**, nunca `403`.
- **Cero SQL crudo con entrada del usuario.** Solo query builder de Drizzle o `sql` con parámetros. `sql.raw` está prohibido.
- **Cero PII en logs:** nada de correos completos, teléfonos, direcciones, tokens, cookies ni cuerpos de petición. Usa `log.*`, que aplica `redact()`.
- **Tokens:** `crypto.getRandomValues` (32 bytes, base64url). En la base solo se guarda su SHA-256. Comparación en tiempo constante. `Math.random()` está prohibido para cualquier cosa de seguridad.
- **Secretos:** solo por `c.env` validado en `env.ts`. Nunca en código, `wrangler.jsonc`, tests ni logs.
- **Variable de entorno nueva** = agregarla en `env.ts`, `.dev.vars.example` y `.env.example` en el mismo PR.

### Diseño

- `routes` → `service` → `repository`. Las rutas no tocan `db`; los repositorios no aplican reglas de negocio.
- Sin estado mutable a nivel de módulo: los isolates de Workers se reutilizan entre peticiones. `db`, `auth` y el contexto se crean por petición.
- Sin `process.env`. Los bindings y secretos llegan en `c.env` (o `env` en `queue`/`scheduled`).
- Lanza `AppError` con un código del catálogo. No respondas `c.json({ error })` a mano.

---

## 5. Hono: cómo se escribe aquí

**Tipos de la app**

```ts
// src/types.ts
export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    clientIp: string;
    user: AuthUser | null;
    session: AuthSession | null;
    tenant: TenantContext; // solo existe después de requireMembership
  };
};
```

**Orden de middlewares (fijo, en `app.ts`; no lo reordenes):**

1. `requestId` → 2. `internal` → 3. contexto del cliente (`x-client-ip`) → 4. `bodyLimit` (64 KB) → 5. `secureHeaders` → 6. `rateLimit` por grupo → 7. `session` → 8. guardas por ruta → 9. `validator` → 10. handler. `onError` y `notFound` globales.

**Montaje de rutas privadas**

```ts
// app.ts
const orgScoped = new Hono<AppEnv>().use(requireAuth, requireMembership()); // aplica a todo lo de abajo

orgScoped.route("/catalog", catalogRoutes);
orgScoped.route("/orders", orderRoutes);

app.route("/v1/orgs/:orgId", orgScoped);
app.route("/v1/public", publicRoutes); // sin sesión; Turnstile y cuotas donde aplique
app.route("/v1/auth", authRoutes); // Better Auth
```

**Una ruta típica**

```ts
// modules/catalog/catalog.routes.ts
export const catalogRoutes = new Hono<AppEnv>().post(
  "/products",
  describeRoute({
    tags: ["catalog"],
    summary: "Crear producto",
    responses: {
      201: {
        description: "Producto creado",
        content: { "application/json": { schema: resolver(ProductDto) } },
      },
    },
  }),
  requirePermission("catalog:write"),
  validator("json", CreateProductInput),
  async (c) => {
    const product = await createProduct(deps(c), c.req.valid("json"));
    return c.json(product, 201);
  },
);
```

- `deps(c)` devuelve `{ db, tenant, actor, env, ctx }`. Los servicios reciben eso como argumento; no leen `c`.
- `requireVerifiedEmail` se agrega en rutas que exponen el negocio al público (publicar para comensales, activar WhatsApp, invitar miembros).
- Trabajo opcional después de responder: `c.executionCtx.waitUntil(promesa)`. Nunca dejes una promesa sin `await` ni `waitUntil`.
- Paginación por cursor (`cursor`, `limit` ≤ 100). Nunca `offset` sin tope.

---

## 6. Datos: Drizzle y D1

**Convenciones del esquema**

| Tema         | Regla                                                                                |
| ------------ | ------------------------------------------------------------------------------------ |
| Ids          | `text` con UUIDv7 (`shared/ids.ts`). Nada de autoincrementales expuestos             |
| Tenant       | `organization_id text not null` en toda tabla de negocio, con FK                     |
| Tiempo       | `integer` en ms UTC: `created_at`, `updated_at`; zona horaria en `branches.timezone` |
| Dinero       | Enteros en centavos + `currency` (`MXN`). Nunca `real`                               |
| Enums        | `text` + `CHECK` generado desde la constante de `contracts`                          |
| Borrado      | Lógico (`deleted_at`) en catálogo. Los pedidos nunca se borran                       |
| Concurrencia | Columna `version integer not null default 1` en pedidos y catálogo                   |
| Índices      | Compuestos que empiezan por `organization_id`                                        |
| Nombres      | Tablas y columnas en `snake_case` plural; propiedades TS en `camelCase`              |

**Repositorios**

```ts
// Toda función de recurso de tenant recibe tenant y filtra por organización
export function findProduct(db: DB, tenant: TenantContext, id: string) {
  return db.query.products.findFirst({
    where: (p, { and, eq, isNull }) =>
      and(eq(p.organizationId, tenant.orgId), eq(p.id, id), isNull(p.deletedAt)),
  });
}
```

- **Atomicidad:** D1 no soporta transacciones interactivas. **No uses `db.transaction()`**. Calcula todo primero y escribe en un solo `db.batch([...])`.
- **Concurrencia optimista:** `update … set version = version + 1 where id = ? and organization_id = ? and version = ?`. Cero filas afectadas → `AppError('CONFLICT')`.
- **Sin N+1:** arma lecturas compuestas con `db.batch` o joins. Objetivo: menos de 10 consultas por petición. Revisa `meta.rows_read` en pruebas de rutas calientes.
- Listas de `staff` filtran por sus sucursales en SQL (`inArray(branchId, tenant.branchIds)`), no en memoria.

**Migraciones**

- Se generan con `drizzle-kit`. **Nunca edites una migración ya fusionada en `main`.**
- Cambios destructivos (renombrar, borrar columna, cambiar tipo) en dos pasos: _expand/contract_, cada uno en su PR.
- Las tablas de Better Auth se generan con su CLI hacia `packages/database/src/schema/auth.ts`. Solo se les agregan columnas documentadas en un ADR.
- Toda migración se prueba aplicándola desde cero en los tests de integración.

---

## 7. Autenticación y autorización

**Autenticación**

- Better Auth vive solo en `modules/auth`. Los demás módulos leen `c.var.user` / `c.var.session`; si necesitan algo de identidad, llaman a `auth.service`.
- `createAuth(env)` se instancia **por petición**.
- `requireEmailVerification` de Better Auth va en `false`: la regla de correo verificado se aplica en nuestras guardas y políticas (ADR-008).
- `sendVerificationEmail` y `sendResetPassword` **encolan** `email.send`; nunca envían en línea.
- Respuestas sin enumeración: reset y reenvío responden siempre "Si el correo existe, te enviamos un enlace".

**RBAC (rol → permiso)**

- `shared/authz/permissions.ts` es la **única** fuente de verdad. Roles del MVP: `owner`, `admin`, `staff`.
- Cada ruta privada declara su permiso con `requirePermission('<recurso>:<acción>')`.
- Permiso nuevo = agregarlo a la tabla de permisos + a la prueba de matriz rol × permiso, en el mismo PR.

**ABAC (atributos del recurso y del contexto)**

- Políticas en `shared/authz/policies.ts`: funciones **puras**, sin I/O, que reciben vistas mínimas (`OrderAuthView`) y devuelven `allow()` o `deny(code)`.
- El servicio carga el recurso, llama a la política y **después** escribe. Nunca al revés.
- Atributos del MVP: `actor.emailVerified`, `tenant.branchIds`, `resource.orgId/branchId`, `resource.status`, `resource.version`, `target.role`, `org.plan` + uso, `branch.isOpen(now)`.
- Reglas fijas: `admin` no modifica a un `owner`; nunca se elimina al último `owner`; `staff` solo opera sus sucursales.

**Guardas obligatorias por ruta privada:** `requireAuth` → `requireMembership` → `requirePermission`. Existe una prueba que recorre todas las rutas registradas y falla si alguna no tiene guarda. No la desactives.

---

## 8. Correo, colas y anti-abuso

- **Correo:** solo a través de `infrastructure/mailer` (`send({ to, template, data })`). Nunca uses `env.EMAIL` fuera de ese adaptador. En desarrollo el adaptador imprime destinatario, asunto y enlace en la terminal de `wrangler dev` (un Worker no puede escribir archivos).
- **Antes de crear una cuenta:** Zod + normalización, lista de dominios desechables y chequeo MX (`email_domain_checks`, 24 h). Nunca sondeo SMTP.
- **Cola:** un solo productor (`infrastructure/jobs.ts`) y un solo consumidor. Los mensajes son una unión discriminada de Zod en `contracts` (`type: 'email.send' | 'notification.whatsapp' | …`). Un mensaje inválido va a la DLQ sin reintento.
- **Consumidores idempotentes:** cada efecto externo tiene una llave de deduplicación única en D1. Asume entrega _at least once_.
- **Outbox** solo para avisos de pedidos: se inserta en el mismo `db.batch` que el pedido. Los correos de auth se encolan directo.
- **Anti-abuso:**
  - `verifyTurnstile(token, clientIp)` en registro, reset, aceptación de invitación sin sesión y pedido público; en login tras 3 fallos solo cuando ADR-010 lo acepte. El token viaja en el header `x-turnstile-token` y es de un solo uso.
  - `rateCounters.hit(key, windowMs, limit)` para cuotas exactas (ver ADR-010).
  - El binding `ratelimits` es filtro grueso; no lo uses como cuota de negocio.
- **Proveedores externos** (Meta, Turnstile, DNS): siempre con timeout (`AbortSignal.timeout(10_000)`), errores clasificados en transitorios y permanentes, y simulados en pruebas.

---

## 9. Errores, logs y documentación

**Errores** — catálogo en `packages/contracts/src/errors.ts`:

| Código                 | HTTP | Uso                                            |
| ---------------------- | ---- | ---------------------------------------------- |
| `VALIDATION_FAILED`    | 400  | Zod rechazó la entrada (incluye `fieldErrors`) |
| `AUTH_REQUIRED`        | 401  | Sin sesión válida                              |
| `EMAIL_NOT_VERIFIED`   | 403  | La acción requiere correo verificado           |
| `FORBIDDEN`            | 403  | Rol sin permiso dentro de su propio tenant     |
| `NOT_FOUND`            | 404  | No existe o pertenece a otro tenant            |
| `CONFLICT`             | 409  | `version` vieja o valor único tomado           |
| `IDEMPOTENCY_CONFLICT` | 409  | Misma llave con otro cuerpo                    |
| `INVALID_TRANSITION`   | 422  | Cambio de estado no permitido                  |
| `BUSINESS_RULE`        | 422  | Cerrado, zona no atendida, producto agotado    |
| `PLAN_LIMIT_REACHED`   | 402  | Límite del plan                                |
| `RATE_LIMITED`         | 429  | Con `Retry-After`                              |
| `INTERNAL`             | 500  | Inesperado; detalle solo en el log             |

- Formato de respuesta: `{ code, message, requestId, fieldErrors? }`.
- `message` en español de México, con el estilo de `apps/web/DESIGN.md §6`: qué pasó y cómo arreglarlo. Ej.: "Este producto ya no está disponible. Quítalo para continuar."
- No agregues códigos nuevos sin actualizar el catálogo y avisar en el PR.

**Logs**

- JSON estructurado con `log.info|warn|error(evento, datos)`. Eventos en `dot.case`: `order.created`, `email.enqueued`, `auth.login_failed`.
- Siempre incluye `requestId`; `orgId` cuando exista. Nada de PII.

**Documentación de la API**

- Cada ruta lleva `describeRoute` con `tags`, `summary` y respuestas con `resolver(schema)`.
- Ejemplos solo con datos ficticios ("Tacos El Güero", `+52 55 0000 0000`).
- `/docs` y `/openapi.json` se registran **solo** dentro de `registerDocs()` cuando `ENVIRONMENT === 'development'`. No registres rutas de documentación en ningún otro lugar.
- Corre `pnpm --filter api openapi:export` y versiona `docs/api/openapi.json` en el PR.

---

## 10. Pruebas

- **Unitarias:** políticas en tabla (rol × acción × estado), máquina de estados, cálculo de totales, horarios, `redact()`.
- **Integración** con `@cloudflare/vitest-pool-workers`: migraciones aplicadas desde cero en el setup; D1, R2 y cola locales.
- **Por cada ruta privada nueva**, como mínimo:
  - sin sesión → `401`;
  - miembro de otra organización con ids reales de la primera → `404`;
  - rol sin permiso → `403`;
  - caso feliz con el DTO validado contra su esquema.
- **Abuso** donde aplique: cuota excedida, Turnstile inválido o reutilizado, llave de idempotencia repetida, `version` vieja.
- **Turnstile en pruebas:** usa las claves de prueba de Cloudflare (`1x0000000000000000000000000000000AA` siempre pasa, `2x0000000000000000000000000000000AA` siempre falla).
- Meta, Email Service y DNS se simulan. **Ninguna prueba apunta a recursos remotos.**

---

## 11. Definición de terminado

Antes de reportar una tarea como terminada:

- [ ] Leí `AGENTS.md` y `ADR.md`; el cambio respeta los ADR aceptados.
- [ ] Esquemas nuevos en `packages/contracts`, estrictos, con esquema de respuesta.
- [ ] Cada ruta nueva tiene `requirePermission` y, si toca un recurso, su política ABAC.
- [ ] Ningún repositorio de tenant sin `organization_id` en el `where`.
- [ ] Errores con códigos del catálogo y mensajes en español de México.
- [ ] Variables de entorno nuevas en `env.ts`, `.dev.vars.example` y `.env.example`.
- [ ] Migración generada, revisada y aplicada desde cero en tests; _expand/contract_ si es destructiva.
- [ ] Logs sin PII; respuestas públicas sin datos sensibles.
- [ ] Pruebas de 401, 404 entre tenants y 403 por rol para cada ruta privada nueva.
- [ ] `/docs` muestra la ruta en local; `docs/api/openapi.json` actualizado.
- [ ] Ninguna dependencia nueva fuera de la lista permitida.
- [ ] `pnpm --filter api check`, `lint` y `test` pasan.
- [ ] Reporte final: archivos tocados, endpoints, tablas/migraciones, permisos nuevos y cualquier punto que los ADR no cubrían.

---

## 12. Cuándo detenerte y preguntar

- La tarea contradice un ADR `Aceptado` o depende de uno `Propuesto`.
- Necesitas una dependencia, un binding, un secreto, una tabla o un endpoint público que **la tarea no indica**.
- Necesitas una tabla que no está en el modelo del ADR-016 o una migración destructiva.
- Vas a cambiar la matriz de permisos, el catálogo de errores o la máquina de estados de pedidos fuera de lo que pide la tarea.
- El cambio afecta `apps/web` sin que la tarea lo diga, o rompe un contrato que el frontend ya consume.
- Una regla de negocio no está definida (horarios, cancelaciones, impuestos, zonas). No la inventes.
- Cualquier cosa relacionada con pagos en línea: está fuera del MVP.
