# AGENTS.md — MenusMax (raíz del monorepo)

Punto de entrada para cualquier agente de IA. Este archivo solo dice **qué leer** y las reglas que aplican a todo el repositorio; las reglas detalladas viven en el `AGENTS.md` de cada app.

---

## 1. Qué leer según dónde trabajas

| Si la tarea toca…                                     | Lee completo antes de empezar                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api`, `packages/contracts`, `packages/database` | `apps/api/AGENTS.md` + `apps/api/docs/adr/ADR.md`                              |
| `apps/web`                                            | `apps/web/AGENTS.md` + `apps/web/DESIGN.md`                                    |
| Ambas apps                                            | Los dos `AGENTS.md`, `DESIGN.md` y `ADR.md`                                    |
| Cualquier tarea                                       | `README.md` (arquitectura), la tarea y su fila de estado (ver tabla siguiente) |

**Dónde están las tareas**

| Backlog  | Tareas                              | Estado                    |
| -------- | ----------------------------------- | ------------------------- |
| Backend  | `apps/api/docs/tasks/phase-XX-*.md` | `apps/api/docs/STATUS.md` |
| Frontend | `docs/tasks/task-NN-*.md`           | `docs/tasks/INDEX.md`     |

`apps/api/docs/tasks/` y `apps/api/docs/STATUS.md` son planeación local (están en `.gitignore`). Los números de task del backend (`TNN`) y del frontend (`task-NN`) son independientes: confirma de cuál backlog se trata antes de empezar.

Si una tarea toca ambas apps, el orden es: contrato en `packages/contracts` → API → web. Los cambios de contrato deben ser compatibles con la versión anterior durante el despliegue.

---

## 2. Comandos globales

```bash
pnpm install          # siempre pnpm; nunca npm ni yarn
pnpm dev              # web + api en local
pnpm lint             # oxlint
pnpm format:check     # oxfmt
pnpm check            # tipos en todos los paquetes
pnpm test
```

**Nunca ejecutes:** despliegues (`wrangler deploy`), migraciones o comandos con `--remote`, `wrangler secret put`, ni nada contra staging o producción. Eso lo hace un humano o CI.

---

## 3. Reglas para todo el repo

- **TypeScript estricto** en todos los paquetes. Sin `any` (oxlint lo rechaza).
- **Idioma:** identificadores y nombres de archivo en inglés; textos de UI, mensajes de error, documentación y commits en español de México.
- **Contratos:** los esquemas Zod viven solo en `packages/contracts`. Ninguna app redefine un esquema que ya existe ahí.
- **Dependencias:** cada app tiene su lista permitida. Cualquier otra requiere un ADR aprobado en `apps/api/docs/adr/ADR.md`.
- **Variables de entorno:** si una task usa o introduce una variable, se agrega a `.env.example` (y a `.dev.vars.example` de la app) en el mismo PR. Nunca se commitean valores reales.
- **No crees carpetas, paquetes ni archivos que la tarea no necesita.**
- **Pagos en línea están fuera del MVP.** No agregues nada relacionado.

---

## 4. Flujo de trabajo con git

- **Una rama por task**, creada desde `main` actualizado: `<tipo>/<tNN>-<slug>`. Ej.: `feat/t07-better-auth`, `fix/t21-idempotencia-pedido`.
- **Commits pequeños** con Conventional Commits y alcance: `feat(api): agrega requireMembership`, `test(api): aislamiento entre tenants en catálogo`. `lefthook` corre lint, formato, tipos y commitlint en cada commit.
- **Push y PR con `gh`**, descripción corta:

  ```markdown
  ## Qué

  ## Por qué (task TNN)

  ## Cómo probar

  ## Checklist

  - [ ] Definición de terminado del AGENTS.md correspondiente
  ```

- **No commitees** `apps/api/docs/STATUS.md` ni `apps/api/docs/tasks/`: son planeación local.
- No hagas `force push` a `main` ni reescribas historia compartida.

---

## 5. Cuándo detenerte y preguntar

- La tarea contradice un ADR `Aceptado`, `DESIGN.md` o el `AGENTS.md` de la app.
- Necesitas una dependencia, un binding de Cloudflare o un secreto nuevo.
- El cambio rompe un contrato que ya consume la otra app.
- Una regla de negocio no está definida. No la inventes.

---

## 6. Al terminar

Reporta: task, rama, archivos tocados, qué cambió, cómo se probó, y cualquier punto donde la documentación no cubría el caso. Actualiza la fila de la task en su archivo de estado (sección 1).

---

## 7. Ejecutar una task del backend ("comienza task NN")

Cuando el usuario diga **"comienza task NN"** (o "comienza la task NN", "empieza TNN") sobre el backend:

1. Lee `apps/api/docs/PROMPT-MAESTRO.md` y síguelo completo, sustituyendo `TNN` por la task indicada (`01` → `T01`).
2. Busca la task en `apps/api/docs/tasks/phase-XX-*.md`. Si no existe su archivo o su sección, **detente** y avisa; no la inventes a partir de `STATUS.md`.
3. Revisa en `apps/api/docs/STATUS.md` que sus dependencias estén `hecha`. Si falta alguna, dila y detente.
