# Prompt de paridad — tasks del frontend para lo nuevo de la API

> Pega este prompt en Claude Code, Codex o Cursor y reemplaza `TNN`, `TMM` y `BX`. Por ejemplo: `T21`, `T23`, `B5`.
> Todas las rutas son relativas a la raíz del monorepo. Para ejecutar una task del backend se usa otro prompt: `apps/api/docs/PROMPT-MAESTRO.md`.

**Cuándo correrlo:** una vez por fase del backend, cuando **todas** sus tasks están fusionadas en `main`. Se audita lo implementado, no lo planeado.

| Fase              | Tasks del backend | Endpoints que se esperan                                                                               |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| B5 Pedidos        | T21–T23           | `POST /v1/public/orders`, `GET /v1/public/orders/:token`, `GET` y `POST …/branches/:branchId/orders/*` |
| B6 WhatsApp       | T24–T25           | `GET` y `POST /v1/webhooks/meta`                                                                       |
| B7 Endurecimiento | T26–T27           | `GET /v1/orgs/:orgId/audit`                                                                            |

---

Vas a generar las **tasks de paridad del frontend** para lo que entregaron las tasks **TNN a TMM del backend** de MenusMax (fase BX). No escribes código de `apps/web`, `apps/api` ni `packages/contracts`: solo documentación en `docs/tasks/`.

**Regla:** la API es la única fuente de verdad y dicta el alcance del frontend.

- Todo endpoint, campo, parámetro, header, validación, error y estado que la API ya soporta debe tener su control en la interfaz y una task que lo conecte, aunque hoy no exista en el diseño.
- No recortes nada de la API porque falte en la UI.
- Lo que la UI tiene y la API no se adapta: si el backend lo tiene planeado en una task pendiente, sigue simulado con `// TEMPORAL`; si no está planeado, se quita.

**1. Contexto (lee antes de escribir)**

- `AGENTS.md` (raíz), `apps/web/AGENTS.md` y `apps/web/DESIGN.md` completos.
- `docs/tasks/PARIDAD-API.md` (regla, base de la auditoría, matriz y pedidos al backend) y `docs/tasks/INDEX.md`.
- Las tasks `docs/tasks/task-16-*.md` en adelante, como formato de referencia.
- Para cada task de TNN a TMM:
  - su fila en `apps/api/docs/STATUS.md` y su sección en `apps/api/docs/tasks/phase-XX-*.md`;
  - debe estar `hecha` y fusionada en `main`. Si alguna está `en revisión`, revisa su PR con `gh pr view <n> --json state`. Si no está `MERGED`, detente y dime cuál.
- Los ADR que citan esas tasks en `apps/api/docs/adr/ADR.md`. Si un comportamiento depende de un ADR `Propuesto`, márcalo como bloqueo; no lo des por hecho.

Confirma en tu primer mensaje:

- "Leí AGENTS.md, DESIGN.md y PARIDAD-API.md";
- las tasks del backend que vas a auditar;
- el commit base que tomaste de `PARIDAD-API.md`;
- el número de la primera task nueva del frontend.

**2. Audita el backend (lo implementado, no lo planeado)**

- `git checkout main && git pull`.
- Toma el commit de la última fila de «Base de la auditoría» en `PARIDAD-API.md` y revisa `git diff <commit>..main -- packages/contracts/src docs/api/openapi.json`.
- Para cada endpoint nuevo o cambiado, registra:
  - método, ruta, permiso y rol que lo puede usar;
  - headers (`Idempotency-Key`, `x-turnstile-token`, `If-None-Match`/`ETag`…) y parámetros de query (`since`, `cursor`, `status`…);
  - cada campo de entrada con su validación exacta: límites, formato y mensaje del contrato;
  - cada campo del DTO de salida;
  - cada código de error con su mensaje, cuotas y `Retry-After`;
  - enums, estados y transiciones (`FINAL_STATUSES`, máquina de estados) y las constantes exportadas.
- Incluye las rutas que WEB debe exponer aunque no sean pantalla (por ejemplo, reenviar el webhook de Meta a la API) y los comportamientos sin endpoint que cambian lo que muestra WEB (anonimización, avisos).
- Si la sección de la fase promete algo que no está en `main`, no lo uses: anótalo como diferencia en el reporte.

**3. Cruza contra la UI**

- Para cada elemento de la auditoría, responde:
  - ¿existe el control o la vista?
  - ¿valida igual que el contrato?
  - ¿muestra cada error y cada estado?
- Busca los mocks que esperaban estas tasks: `grep -rn "TEMPORAL" apps/web/src` y las menciones de TNN a TMM.
- Busca en las tasks del frontend ya escritas lo que quedó en «Fuera de alcance» o «Bloqueada por» esperando a TNN–TMM. Eso entra ahora.

**4. Genera**

- **`PARIDAD-API.md`:**
  - agrega una fila a «Base de la auditoría» con la fecha, el commit de `main` que auditaste, el backend cubierto y las tasks nuevas;
  - agrega filas nuevas a la matriz, en su sección o en una sección nueva;
  - mueve a la matriz lo que estaba en «Lo que la UI tiene y la API no» y ya tiene API;
  - agrega los pedidos al backend nuevos.
- **Tasks nuevas** `docs/tasks/task-NN-<slug>.md`:
  - numeración desde la siguiente libre;
  - una por pantalla o flujo, no por endpoint;
  - mismo formato que task-16 a task-33: encabezado (Prioridad, Categoría «Paridad con la API», Depende de, Bloqueada por), nota de numeración, Contexto con la tabla de rutas y contratos, Objetivo, «Campos y validaciones» (control | contrato | hoy | cambio), Archivos involucrados (con `DESIGN.md` si agrega controles), Pasos sugeridos, Criterios de aceptación verificables (pruebas en el proyecto `integracion`; `check`, `lint` y `test`), Fuera de alcance.
- **Tasks existentes:** si lo nuevo deja incompleta una task ya escrita, actualízala en lugar de duplicarla.
- **`INDEX.md`:** filas nuevas y el criterio de cierre de la fase del backend que estas tasks permiten cumplir.
- No inventes reglas de negocio. Los mensajes de error salen de la API. Los textos nuevos de la UI se proponen dentro de la task para `DESIGN.md §6`.

**5. Verifica y entrega**

- Comprueba con un script que cada ruta de `docs/api/openapi.json` aparezca en `PARIDAD-API.md` o en una task.
- Corre `pnpm format:check`.
- Rama `docs/task-NN-paridad-<fase>` desde `main` actualizado; commit con Conventional Commits en español.
- PR con `gh`:
  - Qué (tabla de tasks), Por qué (TNN–TMM);
  - qué se adapta o se quita de la UI;
  - pedidos al backend como casillas sin marcar;
  - Cómo probar y Checklist.
- Reporte final:
  - link del PR;
  - tasks nuevas y actualizadas;
  - brechas encontradas;
  - adaptaciones;
  - pedidos al backend;
  - diferencias entre la documentación de la fase y lo implementado.
