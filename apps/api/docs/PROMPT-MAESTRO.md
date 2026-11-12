# Prompt maestro — ejecutar una task del backend

> Pega este prompt en Claude Code, Codex o Cursor y reemplaza `TNN` (ej. `T07`). Uso corto: "comienza task NN".
> Todas las rutas son relativas a la raíz del monorepo.

---

Vas a ejecutar la **task TNN del backend** de MenusMax (no confundir con `docs/tasks/task-NN-*.md`, que es el backlog del frontend).

**1. Contexto (lee antes de tocar código)**

- `AGENTS.md` (raíz) y `apps/api/AGENTS.md` completos.
- `apps/api/docs/adr/ADR.md`: los ADR `Aceptado` son obligatorios. Si la task depende de uno `Propuesto` (o de la parte `Propuesta` de un ADR), detente y pregúntame.
- La fila de TNN en `apps/api/docs/STATUS.md` y su sección en `apps/api/docs/tasks/phase-XX-*.md`.
  - **La numeración de `STATUS.md` manda.** Si el encabezado del archivo de fase usa otro número, identifica la sección por su contenido (entrega, ADR, dependencias) y avísame de la discrepancia.
  - Si no encuentras la sección, detente; no la inventes a partir de `STATUS.md`.
- Si la task toca el frontend, también `apps/web/AGENTS.md` y `apps/web/DESIGN.md`.

Confirma en tu primer mensaje: "Leí AGENTS.md y ADR.md", más una línea con módulo, endpoints, tablas y permisos que vas a tocar.

**2. Antes de programar**

- Verifica que sus dependencias estén `hecha` en `STATUS.md`.
  - Si alguna está `en revisión`, revisa su PR con `gh pr view <n> --json state`. Si ya está `MERGED`, dímelo y pregunta si la marco `hecha`.
  - Si falta cualquier otra, dime cuál y detente.
- Si la task toca más de 3 archivos o crea una migración, preséntame un plan corto: archivos, endpoints, tablas, permisos, variables/bindings y dependencias nuevas.
  - Incluye en el mismo mensaje cualquier duda o caso no cubierto por la documentación, para resolver todo en una sola ronda.
  - Espera mi confirmación.
- Con el visto bueno: `git checkout main && git pull`, y crea la rama `<tipo>/tNN-<slug>` (ej. `feat/t07-better-auth`).

**3. Mientras programas**

- Solo lo que dice el alcance de la task. Lo que esté en "Fuera de alcance" no se toca.
- Commits pequeños con Conventional Commits en español (`feat(api): …`, `test(api): …`, `feat(contracts): …`, `feat(database): …`).
  - `lefthook` corre oxlint, oxfmt, tipos y commitlint en cada commit. Si falla, corrige; nunca uses `--no-verify`.
- Si la task usa o introduce variables de entorno o bindings, agrégalos a `apps/api/src/env.ts`, `apps/api/.dev.vars.example` y `.env.example` en la misma rama.
  - Los bindings que no son secretos (D1, R2, colas) van en `env.ts` y `wrangler.jsonc`, no en `.dev.vars.example`.
- Ninguna dependencia fuera de la lista permitida sin preguntarme.
- Desactivar una regla de lint solo en una línea, con comentario `-- motivo`. Nunca en todo el archivo ni en la configuración.
- Antes de cambiar de rama, confirma con `git status` que no hay cambios sin commitear.
- Nunca ejecutes despliegues, comandos `--remote` ni `wrangler secret put`. Los `database_id` e ids reales los pone un humano; usa placeholders.

**4. Antes de abrir el PR**

- `pnpm --filter api check`, `pnpm --filter api lint` y `pnpm --filter api test` en verde.
- Si tocaste `packages/*`, también `pnpm check` en la raíz.
- Si la task cambia una ruta, levanta `pnpm --filter api dev` y prueba la ruta con `curl` en `http://localhost:8787`.
- Si agregaste rutas: `pnpm --filter api openapi:export` y verifica `/docs` en local. Si el script todavía no existe (antes de T04), dilo en el reporte; no lo crees fuera de su task.
- Repasa la "Definición de terminado" de `apps/api/AGENTS.md` punto por punto. Marca como "no aplica" lo que no corresponda, con el motivo.
- Advertencias que ya existían antes de tu cambio: repórtalas, no las arregles fuera de alcance.

**5. Entrega**

- `git push -u` y `gh pr create` con:
  - Título: `<tipo>: <resumen> (TNN)`.
  - Descripción corta: Qué, Por qué (TNN + ADR), Cómo probar (comandos exactos), Checklist.
  - Lo que debe hacer un humano (ids reales, secretos, aprobaciones) como casillas sin marcar.
- No incluyas `apps/api/docs/STATUS.md` ni `apps/api/docs/tasks/` en el PR.
- Actualiza la fila de TNN en `apps/api/docs/STATUS.md` a `en revisión`, con rama y número de PR.
- Reporte final:
  - Link del PR, y si check, lint y test pasaron.
  - Archivos tocados, endpoints, migraciones/tablas, permisos nuevos, variables y bindings nuevos, dependencias nuevas.
  - Decisiones que tomaste donde la documentación no era explícita, y casos que no cubría.
  - Pendientes para un humano.
