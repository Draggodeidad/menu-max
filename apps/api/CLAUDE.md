# CLAUDE.md — apps/api

Toda la documentación para agentes del backend vive dentro de `apps/api`. Las rutas `docs/...` de estos archivos son relativas a `apps/api`.

@AGENTS.md
@docs/adr/ADR.md
@docs/AGENTS-raiz.md

## Notas para Claude Code

- Para tasks que tocan más de 3 archivos o crean migraciones, presenta primero un plan corto (archivos, endpoints, tablas) y espera confirmación.
- Usa `gh` para ramas, push y PR según la sección 4 de `docs/AGENTS-raiz.md`.
- Si una instrucción de la sesión contradice `AGENTS.md` o un ADR aceptado, señálalo antes de actuar.
- "comienza task NN" → sigue `docs/PROMPT-MAESTRO.md` con la task de `docs/tasks/phase-XX-*.md` y su fila en `docs/STATUS.md`.
