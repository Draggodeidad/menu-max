# Task 16 — Base para integrar la API

**Prioridad:** P0
**Categoría:** Integración con la API
**Depende de:** task-01 a task-15 (terminadas)

> No confundir con la task T16 del backend (`apps/api/docs/STATUS.md`): los dos backlogs numeran por separado. Esta task usa lo que entregaron T05 (`$lib/server/api.ts`), T07 (Better Auth) y T09 (Turnstile) del backend.

## Contexto

Las tasks 01 a 15 dejaron todas las pantallas funcionando con datos simulados (`apps/web/AGENTS.md §0.1`). El backend ya expone identidad, onboarding, tenancy, catálogo, ajustes, menú público e invitaciones (`docs/api/openapi.json`). Le faltan los pedidos (T21–T23) y WhatsApp (T24–T25).

`apps/web/src/lib/server/api.ts` ya existe (T05) y ninguna pantalla lo usa. Hoy lanza `error(status)` ante cualquier respuesta que no sea 2xx. Eso sirve en un `load`, pero no en una form action, que necesita devolver `fail(400, { fieldErrors })` para mostrar el error bajo el campo.

Esta task prepara lo que comparten todas las pantallas que se conectan en las tasks 17 a 24. Todavía no conecta ninguna.

## Objetivo

- Las reglas de `apps/web` describen la fase de integración y dejan de decir que no hay API.
- Una form action puede llamar a la API y convertir sus errores en `fail()` sin repetir código.
- Un desarrollador levanta WEB y la API en local con un solo comando, y Playwright puede correr pruebas contra esa API local.
- El widget de Turnstile existe una sola vez y lo usan `/crear`, `/restablecer` e `/invitacion`.

## Archivos involucrados

- `apps/web/AGENTS.md`: §0.1 (fase actual), §6.1 y §8 (pruebas).
- `apps/web/DESIGN.md §8`: quitar «(cuando exista la API)» de `server/api.ts`.
- `apps/web/src/lib/server/api.ts` y `api.test.ts`.
- `apps/web/src/lib/components/Turnstile.svelte` (nuevo: lo usan tres rutas).
- `apps/web/.dev.vars.example` y `.env.example` (raíz): la clave pública de Turnstile.
- `playwright.config.ts` y `e2e/fixtures.ts`: el proyecto de integración.
- `README.md` (raíz): sección de desarrollo local con las dos apps.

## Pasos sugeridos

1. **Reglas de la fase.** En `AGENTS.md §0.1`, reemplazar «Fase actual: frontend con datos mock» por la fase de integración:
   - una pantalla conectada lee y escribe solo por `#lib/server/api.ts`; sus mocks se borran de `demo.ts` en la misma task;
   - lo que la API todavía no tiene (pedidos, seguimiento, WhatsApp) sigue en `demo.ts`, marcado `// TEMPORAL: sin API todavía (T21–T25)`;
   - `demo.ts` se borra cuando ya nadie lo importe;
   - los esquemas salen de `@menu-max/contracts`: ninguna action vuelve a escribir una validación que ya tiene el contrato.
2. **`api.ts` para actions.** Agregar una función junto a `api()`, por ejemplo `apiAction(event, path, init, schema)`. Debe:
   - validar el cuerpo de éxito con el DTO de `@menu-max/contracts` (`schema.parse`);
   - con `400`, `401`, `402`, `403`, `404`, `409`, `422` o `429`, devolver `{ ok: false, status, code, message, fieldErrors, retryAfter }` en lugar de lanzar el error, para que la action lo convierta en `fail(status, …)`;
   - con `5xx`, fallas de red o un error con otra forma, comportarse como `api()` (`502` con el mensaje de servicio no disponible);
   - reenviar `set-cookie` también en las respuestas de error. El onboarding abre sesión aunque su batch falle (backend T20).
3. **Turnstile.** Crear `Turnstile.svelte`:
   - carga el script de `challenges.cloudflare.com` solo en las pantallas que lo usan;
   - pone el token en un `<input type="hidden" name="turnstileToken">`;
   - después de un envío fallido, el widget se reinicia, porque cada token sirve una sola vez.

   La action lo reenvía en el header `x-turnstile-token`. La clave pública va en `PUBLIC_TURNSTILE_SITE_KEY`; en local se usa la clave de prueba de Cloudflare que siempre pasa.

4. **Entorno local.** Documentar en `README.md`:
   - copiar `apps/web/.dev.vars` y `apps/api/.dev.vars` con el mismo `INTERNAL_TOKEN`;
   - correr `pnpm --filter api db:migrate:local`;
   - levantar las dos apps con `pnpm dev`.

   Verificar que el binding `API` del servidor de desarrollo de WEB llega al `wrangler dev` de `menusmax-api-dev`. Si `vite dev` no lo resuelve, documentar la alternativa que sí funcione. No se toca `wrangler.jsonc` sin preguntar.

5. **Pruebas de integración.** Agregar a Playwright un proyecto `integracion`:
   - levanta las dos apps con D1 local y las migraciones aplicadas;
   - las fixtures pueden crear usuarios llamando a la API local con el token interno;
   - nunca apunta a staging ni a producción.

   Las pruebas actuales con mocks siguen en su proyecto hasta que su pantalla se conecte. Actualizar `AGENTS.md §8` con esta regla.

## Criterios de aceptación

- [ ] `AGENTS.md` y `DESIGN.md §8` describen la fase de integración; ninguna regla vigente dice que no hay API.
- [ ] Pruebas unitarias de `apiAction`:
  - éxito validado contra su DTO;
  - `400` con `fieldErrors`, `409` y `429` con `Retry-After` devueltos sin lanzar;
  - `500` y falla de red → `502`;
  - `set-cookie` reenviado en éxito y en error.
- [ ] Con `pnpm dev`, una petición desde el servidor de WEB a `/v1/health` por el binding responde `200`. Es el criterio de cierre de la fase B1 del backend.
- [ ] El proyecto `integracion` de Playwright arranca las dos apps y corre al menos una prueba de humo.
- [ ] `PUBLIC_TURNSTILE_SITE_KEY` está en `.dev.vars.example` y en `.env.example`, con la clave de prueba.
- [ ] `pnpm --filter web check`, `lint` y `test` pasan.

## Fuera de alcance

- Conectar pantallas: tasks 17 a 24.
- Cambios en `apps/api`, `packages/contracts` o `wrangler.jsonc`.
- Despliegues y secretos de staging o producción.
