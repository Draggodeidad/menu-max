# Fase B1 — Fundación del backend

> Planeación del backend (versionada en git).
> **Criterio para cerrar la fase:** WEB llama a `/v1/health` por Service Binding; CI en verde; `/docs` abre en local y responde 404 con `ENVIRONMENT=production`.
> **Orden de ejecución:** T01 → T03 → T02 → T04 → T06 → T05.

---

## T01 — Crear `apps/api` y su configuración por entorno

**Fase:** B1 · **Depende de:** — · **ADR:** 001, 002 · **Rama sugerida:** `feat/t01-api-scaffold`

### Objetivo

Existe un Worker Hono privado que responde `GET /v1/health` en local, con configuración separada para development, staging y production.

### Alcance

- Paquete `apps/api` en el workspace pnpm con TypeScript estricto.
- `src/index.ts` exporta `{ fetch }` (cola y Cron llegan en tasks posteriores).
- `src/app.ts` crea `new Hono<AppEnv>()` y monta `GET /v1/health` → `{ status: 'ok', environment }`.
- `src/env.ts`: esquema Zod de `Env` con `ENVIRONMENT: 'development' | 'staging' | 'production'` e `INTERNAL_TOKEN` (mínimo 32 caracteres). Función `getEnv(env)` que valida una vez y lanza error claro si falta algo.
- `wrangler.jsonc` con `workers_dev: false`, sin `routes`, `compatibility_date` fija, y bloques `env.staging` / `env.production` con nombres de Worker distintos (`menusmax-api`, `menusmax-api-staging`).
- `observability.enabled: true`.
- Scripts `dev`, `check`, `lint`, `test` en `apps/api/package.json`.

### Fuera de alcance

- Middlewares (T02), D1 (T03), docs (T04), CI (T05), cliente en web (T06).
- Cualquier binding que no sea necesario para responder `/v1/health`.

### Archivos esperados

- `apps/api/package.json`, `tsconfig.json`, `wrangler.jsonc`, `.dev.vars.example`, `vitest.config.ts`
- `apps/api/src/index.ts`, `app.ts`, `env.ts`, `types.ts`
- `apps/api/src/app.test.ts`

### Endpoints

| Método | Ruta         | Guardas                  | Entrada | Salida                          |
| ------ | ------------ | ------------------------ | ------- | ------------------------------- |
| GET    | `/v1/health` | (en T02: origen interno) | —       | `{ status: 'ok', environment }` |

### Variables de entorno y bindings

- `ENVIRONMENT` — `vars` en `wrangler.jsonc` por entorno.
- `INTERNAL_TOKEN` — secreto; en local en `.dev.vars`; agregar a `.dev.vars.example` y `.env.example` con valor de ejemplo.

### Pruebas requeridas

- [ ] `/v1/health` responde 200 con el entorno.
- [ ] `getEnv` lanza error si falta `INTERNAL_TOKEN` o es corto.

### Criterios de aceptación

- [ ] `pnpm --filter api dev` levanta en `http://localhost:8787` y `/v1/health` responde.
- [ ] `pnpm --filter api check` y `test` pasan.
- [ ] `wrangler.jsonc` no tiene `routes` ni `workers_dev: true` en ningún entorno.

---

## T03 — Crear `packages/contracts` y `packages/database`

**Fase:** B1 · **Depende de:** T01 · **ADR:** 003, 004, 013 · **Rama sugerida:** `feat/t03-contracts-database`

### Objetivo

Existen los paquetes compartidos de contratos y de base de datos, y la API tiene acceso a D1 con Drizzle.

### Alcance

- `packages/contracts`:
  - `src/errors.ts`: constante `ERROR_CODES` con el catálogo de `apps/api/AGENTS.md §9`, su mapa a HTTP y el esquema Zod de la respuesta de error `{ code, message, requestId, fieldErrors? }`.
  - `src/index.ts` que reexporta. Sin dependencias además de `zod`.
- `packages/database`:
  - `drizzle.config.ts` (dialecto `sqlite`, driver `d1-http` solo para `drizzle-kit`), `src/schema/index.ts`.
  - `src/schema/columns.ts` con helpers: `id()` (text UUIDv7), `organizationId()`, `timestamps()` (`created_at`, `updated_at` en ms), `version()`, `deletedAt()`.
  - Script `db:generate`. **Sin tablas todavía**: la primera migración llega con Better Auth en T07.
- `apps/api`:
  - Binding `DB` (D1) en `wrangler.jsonc` por entorno, con `migrations_dir` apuntando a `packages/database/migrations`. IDs reales los pone un humano; en local basta `database_id` de ejemplo.
  - `src/infrastructure/db.ts`: `createDb(env)` → `drizzle(env.DB, { schema })`.
  - `src/shared/ids.ts`: `newId()` (UUIDv7) y `newPublicToken()` + `hashToken()` (32 bytes base64url, SHA-256).
  - Script `db:migrate:local`.
  - `/v1/health` agrega `db: 'ok'` tras un `select 1`.

### Fuera de alcance

- Tablas de negocio o de identidad.
- `api-client` y `ui` del README: no se crean.

### Pruebas requeridas

- [ ] `newId()` genera UUIDv7 válidos y ordenables.
- [ ] `hashToken()` es determinista y el token tiene 43 caracteres base64url.
- [ ] `/v1/health` reporta `db: 'ok'` con D1 local.

### Criterios de aceptación

- [ ] `pnpm --filter api test` usa D1 local mediante `@cloudflare/vitest-pool-workers`.
- [ ] `packages/contracts` no importa nada de Workers, Hono ni Drizzle.

---

## T02 — Middlewares base, errores y logger

**Fase:** B1 · **Depende de:** T01, T03 · **ADR:** 002, 004 · **Rama sugerida:** `feat/t02-api-middlewares`

### Objetivo

Toda petición pasa por el pipeline fijo de `apps/api/AGENTS.md §5` (pasos 1 a 5 y `onError`), y todo error sale con el formato único.

### Alcance

- `middleware/request-id.ts`: usa `x-request-id` si viene de WEB (formato UUID) o genera uno; lo devuelve en la respuesta.
- `middleware/internal.ts`: exige `x-mm-internal` igual a `INTERNAL_TOKEN`, comparación en tiempo constante; si falla, `404` sin cuerpo explicativo.
- `middleware/client-context.ts`: lee `x-client-ip` y `user-agent` a `c.var`.
- `bodyLimit` de Hono a 64 KB y `secureHeaders()`; `Cache-Control: no-store` por defecto.
- `shared/errors.ts`: clase `AppError(code, message?, fieldErrors?)`.
- `onError`: `AppError` → su HTTP; error de Zod → `VALIDATION_FAILED` con `fieldErrors`; resto → `500 INTERNAL` genérico y log con stack.
- `notFound` → `404 NOT_FOUND` con el mismo formato.
- `shared/log.ts`: `log.info|warn|error(evento, datos)` en JSON con `requestId`; `redact()` para correos (`a***@dominio.com`), teléfonos (`***1234`) y llaves sensibles (`password`, `token`, `cookie`, `authorization`, `address`).

### Fuera de alcance

- Rate limit (T10), sesión (T07), guardas de tenant (T11).

### Pruebas requeridas

- [ ] Sin `x-mm-internal` o con valor incorrecto → 404.
- [ ] `requestId` presente en respuesta y en cuerpo de error.
- [ ] Cuerpo mayor a 64 KB → 413.
- [ ] `AppError('CONFLICT')` → 409 con formato correcto.
- [ ] Error inesperado → 500 sin stack en la respuesta.
- [ ] `redact()` enmascara correo, teléfono y llaves sensibles anidadas.

### Criterios de aceptación

- [ ] El orden de middlewares en `app.ts` coincide con `apps/api/AGENTS.md §5`.
- [ ] Ninguna respuesta de error expone stack, SQL ni nombres internos.

---

## T04 — Documentación de la API solo en desarrollo

**Fase:** B1 · **Depende de:** T02, T03 · **ADR:** 012 · **Rama sugerida:** `feat/t04-api-docs-dev`

### Objetivo

En local, `http://localhost:8787/docs` muestra la referencia de la API generada desde Zod; en staging y producción esas rutas no existen.

### Alcance

- `src/docs.ts` con `registerDocs(app)`: `GET /openapi.json` (`openAPIRouteHandler` de `hono-openapi`) y `GET /docs` (Scalar).
- Registro condicional en `app.ts` solo si `ENVIRONMENT === 'development'`.
- Documentar `/v1/health` con `describeRoute` y su esquema de respuesta desde `contracts`.
- Esquema de error común registrado como componente reutilizable.
- Script `openapi:export` que escribe `docs/api/openapi.json`.
- `registerDocs` monta `/docs` y `/openapi.json` **antes** del middleware interno, para poder abrirlas desde el navegador en local. Es la única excepción a ese middleware y solo existe en development (ADR-012).

### Fuera de alcance

- Documentar endpoints que aún no existen.

### Pruebas requeridas

- [ ] Con `ENVIRONMENT=development`, `/openapi.json` es OpenAPI 3.1 válido e incluye `/v1/health`.
- [ ] Con `ENVIRONMENT=production`, `/docs` y `/openapi.json` → 404.
- [ ] Con `ENVIRONMENT=development`, cualquier otra ruta sin `x-mm-internal` sigue respondiendo 404.

### Criterios de aceptación

- [ ] `/docs` abre en el navegador en local y muestra `/v1/health`.
- [ ] `docs/api/openapi.json` versionado.

---

## T06 — Cliente de la API en `apps/web`

**Fase:** B1 · **Depende de:** T02 · **ADR:** 002 · **Rama sugerida:** `feat/t06-web-api-client`

> Esta task toca `apps/web`: lee también `apps/web/AGENTS.md`. Solo se crea el cliente; no se crean rutas ni pantallas.

### Objetivo

El servidor de SvelteKit puede llamar a la API por Service Binding con el contexto correcto, y nada de eso llega al navegador.

### Alcance

- `apps/web/wrangler.jsonc`: binding `API` al servicio `menusmax-api` (y su variante por entorno).
- `src/app.d.ts`: `App.Platform` con `env.API: Fetcher` e `INTERNAL_TOKEN`.
- `src/lib/server/api.ts`: `api(event, path, init?)` que:
  - llama `event.platform.env.API.fetch('https://api.internal' + path, …)`;
  - agrega `x-mm-internal`, `x-request-id`, `x-client-ip` (de `event.getClientAddress()`), `user-agent`, `origin` y el header `cookie` del request;
  - copia los `set-cookie` de la respuesta al navegador con `event.setHeaders`/`cookies`;
  - si la respuesta es error, lo parsea con el esquema de error de `contracts` y lanza `error(status, { code, message })` de SvelteKit.
- `INTERNAL_TOKEN` en `.dev.vars.example` de web y en `.env.example`.

### Fuera de alcance

- Pantallas, form actions o `hooks.server.ts` de sesión (llegan con T07 en adelante).

### Pruebas requeridas

- [ ] Unitarias de `api.ts` con `platform.env.API` simulado: headers enviados, `set-cookie` reenviado, error mapeado.
- [ ] `api.ts` no se puede importar desde código de cliente (vive en `$lib/server`).

### Criterios de aceptación

- [ ] Con api y web corriendo en local, una llamada de servidor a `/v1/health` responde `ok` vía binding.
- [ ] `pnpm --filter web check` y `test` pasan.

---

## T05 — CI del monorepo

**Fase:** B1 · **Depende de:** T01–T04, T06 · **ADR:** — · **Rama sugerida:** `ci/t05-pipeline`

### Objetivo

Cada PR corre las mismas verificaciones que exige la definición de terminado.

### Alcance

- `.github/workflows/ci.yml` en `pull_request` y `push` a `main`:
  1. `pnpm install --frozen-lockfile` con caché de pnpm.
  2. `pnpm lint` → `pnpm check` → `pnpm test`.
  3. `drizzle-kit check` en `packages/database`.
  4. `pnpm --filter api openapi:export` y falla si `docs/api/openapi.json` cambió sin estar commiteado.
  5. `gitleaks` sobre el diff.
  6. `wrangler deploy --dry-run` para api y web (sin credenciales).
- Versiones de Node y pnpm fijadas (`packageManager` en el `package.json` raíz).

### Fuera de alcance

- Despliegues a staging o producción (fase posterior, con secretos de CI).
- Diff semántico de OpenAPI contra `main` (se agrega cuando haya endpoints reales).

### Criterios de aceptación

- [ ] Un PR de prueba con un error de tipos falla en CI.
- [ ] Un PR limpio pasa en menos de 5 minutos.
