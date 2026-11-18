# Task 16 — Base para integrar la API

**Prioridad:** P0
**Categoría:** Paridad con la API
**Depende de:** task-01 a task-15 (terminadas)

> No confundir con la task T16 del backend: los dos backlogs numeran por separado. Usa T05 (`$lib/server/api.ts`), T07 (Better Auth) y T09 (Turnstile). Regla y matriz: `PARIDAD-API.md`.

## Contexto

Las tasks 01 a 15 dejaron las pantallas con datos simulados (`apps/web/AGENTS.md §0.1`). `#lib/server/api.ts` existe, pero ninguna pantalla lo usa. Hoy lanza `error(status)` ante cualquier respuesta que no sea 2xx: sirve en un `load`, no en una form action, que necesita `fail(400, { fieldErrors })`.

Esta task deja lo que comparten las tasks 17 a 33. No conecta ninguna pantalla.

## Objetivo

- Las reglas de `apps/web` adoptan la regla de `PARIDAD-API.md`: la API dicta el alcance.
- Una form action llama a la API y convierte cualquier código del catálogo de errores en `fail()` sin repetir código.
- Las validaciones salen de `@menu-max/contracts`.
- WEB y la API corren juntas en local, y Playwright prueba contra la API local.

## Lo que la base debe cubrir

| Pieza        | Comportamiento                                                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Errores      | Los 13 códigos de `packages/contracts/src/errors.ts`. `VALIDATION_FAILED` trae `fieldErrors` por ruta del campo (`account.password`, `products.2.name`). `RATE_LIMITED` trae `Retry-After`. `PLAN_LIMIT_REACHED`, `EMAIL_NOT_VERIFIED` y el `403` de suscripción suspendida se distinguen por `code` y `message`. |
| Validación   | Las actions validan con el esquema del contrato antes de llamar. Cada mensaje del contrato llega intacto al campo.                                                                                                                                                                                                |
| Concurrencia | Todo formulario que edita algo con `version` la lleva en un campo oculto. Un `409 CONFLICT` vuelve con los datos recién leídos.                                                                                                                                                                                   |
| Paginación   | Las listas con `nextCursor` (sucursales, miembros, invitaciones) usan un helper común de «Ver más», con `limit` ≤ 100.                                                                                                                                                                                            |
| Idempotencia | Helper para generar la llave en `load` y reenviarla en `Idempotency-Key`.                                                                                                                                                                                                                                         |
| Turnstile    | `Turnstile.svelte` en `#lib/components` (lo usan `/crear`, `/restablecer` e `/invitacion`). El token viaja en `x-turnstile-token` y el widget se reinicia tras cada envío fallido.                                                                                                                                |
| Cookies      | `set-cookie` se reenvía también en respuestas de error. El onboarding abre sesión aunque su batch falle.                                                                                                                                                                                                          |

## Archivos involucrados

- `apps/web/AGENTS.md` (§0.1, §6.1, §8) y `apps/web/DESIGN.md §8`.
- `apps/web/src/lib/server/api.ts` y `api.test.ts`.
- `apps/web/src/lib/components/Turnstile.svelte` (nuevo).
- `apps/web/.dev.vars.example` y `.env.example`: `PUBLIC_TURNSTILE_SITE_KEY`, con la clave de prueba de Cloudflare.
- `playwright.config.ts` y `e2e/fixtures.ts`: proyecto `integracion`.
- `README.md` (raíz): desarrollo local con las dos apps.

## Pasos sugeridos

1. **Reglas.** `AGENTS.md §0.1` pasa a «Fase actual: integración». Debe decir:
   - la regla de `PARIDAD-API.md`;
   - una pantalla conectada borra sus mocks en la misma task;
   - lo que la API no tiene y el backend sí tiene planeado sigue en `demo.ts` con `// TEMPORAL: sin API todavía (TNN)`.

   §8 agrega el proyecto `integracion`: la API local con D1 local, nunca staging ni producción.

2. **`apiAction`.** Junto a `api()`:
   - valida el éxito con el DTO;
   - devuelve `{ ok: false, status, code, message, fieldErrors, retryAfter }` para `4xx`;
   - con `5xx` o fallas de red, se comporta como `api()`.

   Agregar un helper que traduzca las rutas de `fieldErrors` a los `name` de cada formulario.

3. **Helpers.** Paginación por cursor, llave de idempotencia, Turnstile.
4. **Entorno local.** Documentar en `README.md`:
   - el mismo `INTERNAL_TOKEN` en `apps/web/.dev.vars` y `apps/api/.dev.vars`;
   - `pnpm --filter api db:migrate:local`;
   - `pnpm dev`.

   Verificar que el binding `API` llega al `wrangler dev` de `menusmax-api-dev`; si `vite dev` no lo resuelve, documentar la alternativa. `wrangler.jsonc` no se toca sin preguntar.

5. **Playwright.** Agregar el proyecto `integracion`:
   - levanta las dos apps con las migraciones aplicadas;
   - sus fixtures crean usuarios, organizaciones e invitaciones con la API local y el token interno.

## Criterios de aceptación

- [ ] `AGENTS.md` y `DESIGN.md §8` describen la fase de integración y la regla de paridad.
- [ ] Pruebas de `apiAction`:
  - éxito validado;
  - cada código del catálogo devuelto sin lanzar;
  - `fieldErrors` con rutas anidadas traducidos;
  - `Retry-After` leído;
  - `5xx` y falla de red → `502`;
  - `set-cookie` reenviado en éxito y en error.
- [ ] Con `pnpm dev`, `/v1/health` responde `200` desde el servidor de WEB por el binding. Es el cierre de la fase B1 del backend.
- [ ] El proyecto `integracion` arranca las dos apps y corre una prueba de humo.
- [ ] `PUBLIC_TURNSTILE_SITE_KEY` está en `.dev.vars.example` y en `.env.example`.
- [ ] `pnpm --filter web check`, `lint` y `test` pasan.

## Fuera de alcance

- Conectar pantallas (tasks 17 a 33).
- Cambios en `apps/api`, `packages/contracts` o `wrangler.jsonc`.
