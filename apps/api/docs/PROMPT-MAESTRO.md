# Prompt maestro — ejecutar una task del backend

> Planeación local (en `.gitignore`). Pega este prompt en Claude Code, Codex o Cursor y reemplaza `TNN`. Uso corto: "comienza task NN".

---

Vas a ejecutar la **task TNN** del backend de MenusMax.

**1. Contexto (lee antes de tocar código)**

- `AGENTS.md` (raíz) y `apps/api/AGENTS.md` completos.
- `docs/adr/ADR.md`: los ADR `Aceptado` son obligatorios; si la task depende de uno `Propuesto`, detente y pregúntame.
- La task TNN en `docs/tasks/phase-XX-*.md` y su fila en `docs/STATUS.md`.
- Si la task toca el frontend, también `apps/web/AGENTS.md` y `apps/web/DESIGN.md`.

Confirma en tu primer mensaje: "Leí AGENTS.md y ADR.md", más una línea con módulo, endpoints y tablas que vas a tocar.

**2. Antes de programar**

- Verifica que las tasks de las que depende estén `hecha` en `STATUS.md`. Si no, dime cuál falta y detente.
- `git checkout main && git pull`, luego crea la rama `<tipo>/tNN-<slug>`.
- Si la task toca más de 3 archivos o crea una migración, preséntame un plan corto (archivos, endpoints, tablas, permisos) y espera mi confirmación.

**3. Mientras programas**

- Solo lo que dice el alcance de la task. Lo que esté en "Fuera de alcance" no se toca.
- Commits pequeños con Conventional Commits en español (`feat(api): …`, `test(api): …`).
- Si la task usa o introduce variables de entorno o bindings, agrégalos a `env.ts`, `.dev.vars.example` y `.env.example` en la misma rama.
- Ninguna dependencia fuera de la lista permitida sin preguntarme.
- Nunca ejecutes despliegues, comandos `--remote` ni `wrangler secret put`.

**4. Antes de abrir el PR**

- `pnpm --filter api check`, `lint` y `test` en verde.
- Repasa la "Definición de terminado" de `apps/api/AGENTS.md` punto por punto.
- Si agregaste rutas: `pnpm --filter api openapi:export` y verifica `/docs` en local.

**5. Entrega**

- `git push` y `gh pr create` con descripción corta: Qué, Por qué (TNN), Cómo probar, Checklist.
- No incluyas `docs/STATUS.md` ni `docs/tasks/` en el PR.
- Actualiza la fila de TNN en `docs/STATUS.md` a `en revisión` con rama y número de PR.
- Reporte final: archivos tocados, endpoints, migraciones, permisos nuevos, variables nuevas y cualquier caso que la documentación no cubría.
