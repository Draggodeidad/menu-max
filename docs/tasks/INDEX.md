# Backlog del frontend

Leer `apps/web/AGENTS.md` y `apps/web/DESIGN.md` antes de implementar. Los números de este backlog (`task-NN`) son independientes de los del backend (`TNN`, `apps/api/docs/STATUS.md`). El orden desempata tareas con la misma prioridad y reduce conflictos entre archivos.

## Auditoría con datos simulados (task-01 a task-15, terminada)

El alcance fue exclusivamente el frontend con datos simulados. Cada tarea indica cómo reactivar sus pruebas `test.fixme`; no se modificó `apps/api` ni se dio por existente una API.

| Orden | Tarea                                                                                          | Prioridad | Depende de       | Hallazgos |
| ----- | ---------------------------------------------------------------------------------------------- | --------- | ---------------- | --------- |
| 1     | [task-01 — Publicar menú simulado](task-01-publicar-menu-simulado.md)                          | P0        | ninguna          | H01       |
| 2     | [task-02 — Conectar pedido, panel y seguimiento](task-02-conectar-pedido-panel-seguimiento.md) | P0        | ninguna          | H02       |
| 3     | [task-03 — Salida de pedido a WhatsApp](task-03-salida-whatsapp.md)                            | P0        | task-01, task-02 | H03       |
| 4     | [task-04 — Validar productos del pedido](task-04-validar-productos-pedido.md)                  | P1        | task-02          | H04       |
| 5     | [task-05 — Reflejar catálogo en menú público](task-05-catalogo-en-menu-publico.md)             | P1        | task-01          | H05, H12  |
| 6     | [task-06 — Aplicar modalidades guardadas](task-06-aplicar-modalidades.md)                      | P1        | task-05          | H06       |
| 7     | [task-07 — Aplicar tema guardado](task-07-aplicar-tema.md)                                     | P1        | task-05          | H07       |
| 8     | [task-08 — Aislar sesión simulada](task-08-sesion-simulada.md)                                 | P1        | task-01          | H08       |
| 9     | [task-09 — Rechazar recursos desconocidos](task-09-recursos-desconocidos.md)                   | P1        | task-01, task-02 | H09       |
| 10    | [task-10 — Corregir semántica accesible](task-10-semantica-accesible.md)                       | P1        | ninguna          | H10       |
| 11    | [task-11 — Aclarar invitación simulada](task-11-feedback-invitacion.md)                        | P1        | ninguna          | H11       |
| 12    | [task-12 — Error de carga del menú público](task-12-error-carga-menu.md)                       | P1        | task-05          | H13       |
| 13    | [task-13 — Pantalla para aceptar una invitación](task-13-pantalla-invitacion.md) [^task-13]    | P1        | task-08          | —         |
| 14    | [task-14 — Términos y aviso del periodo de prueba](task-14-terminos-periodo-prueba.md)         | P1        | task-01          | —         |
| 15    | [task-15 — Correo ya registrado al publicar el menú](task-15-aviso-cuenta-existente.md) [^15]  | P1        | task-01          | —         |

Para cualquier tarea, primero reproducir el test indicado quitando exclusivamente su marca `fixme`, implementar y volver a ejecutar toda la suite. Cuando un test forma parte de un bucle, eliminar la condición `test.fixme` específica de ese caso y conservar los demás. Las dependencias son funcionales o de archivos compartidos, no autorización para desplegar ni integrar cambios directamente en `main`.

## Integración con la API (task-16 a task-24)

Conecta las pantallas a la API por `#lib/server/api.ts` (Service Binding). Reglas:

- task-16 cambia `apps/web/AGENTS.md §0.1` a la fase de integración; hasta entonces rige la fase con datos simulados.
- Una pantalla conectada borra sus mocks de `demo.ts` en la misma task; lo que la API aún no tiene sigue simulado y marcado `// TEMPORAL`.
- Las pruebas de una pantalla conectada corren en el proyecto `integracion` de Playwright, contra `apps/api` local con D1 local. Nunca contra staging ni producción.
- No se modifica `apps/api` ni `packages/contracts` desde estas tasks. Si el contrato no cubre algo, la task lo deja en «Dudas a resolver antes de empezar» y se pide al backend en su propio PR.
- Cada task lista sus dudas. Se resuelven antes de empezarla, no durante.

| Orden | Tarea                                                                                          | Prioridad | Depende de                | Backend que consume     |
| ----- | ---------------------------------------------------------------------------------------------- | --------- | ------------------------- | ----------------------- |
| 16    | [task-16 — Base para integrar la API](task-16-base-integracion-api.md)                         | P0        | task-01 a task-15         | T05, T07, T09           |
| 17    | [task-17 — Sesión real y `/entrar` con la API](task-17-sesion-real-entrar.md)                  | P0        | task-16                   | T07, T09, T11           |
| 18    | [task-18 — `/crear` y `/app/listo` con `POST /v1/onboarding`](task-18-crear-con-onboarding.md) | P0        | task-16, task-17          | T18, T19, T20, T20c     |
| 19    | [task-19 — Verificar el correo y reenviar el enlace](task-19-verificar-correo.md)              | P0        | task-17, task-18          | T10                     |
| 20    | [task-20 — Restablecer la contraseña](task-20-restablecer-contrasena.md)                       | P1        | task-16, task-17          | T09, T10                |
| 21    | [task-21 — `/invitacion` con la API](task-21-invitacion-con-api.md)                            | P1        | task-16, task-17          | T09, T13                |
| 22    | [task-22 — `/app/catalogo` con la API](task-22-catalogo-con-api.md)                            | P1        | task-17, task-18          | T14, T16, T17           |
| 23    | [task-23 — `/app/ajustes` con la API](task-23-ajustes-con-api.md)                              | P1        | task-17, task-18          | T13, T14, T15, T18, T19 |
| 24    | [task-24 — Menú público con la API](task-24-menu-publico-con-api.md)                           | P1        | task-16, task-22, task-23 | T18 (ADR-014)           |

Con task-16 se cumple el criterio de cierre de la fase B1 del backend (WEB llama a `/v1/health` por Service Binding); con task-19, el de B2, salvo el correo real (Resend, pendiente de un humano); con task-18, el de B4.

**Pendiente de backend, sin task todavía:** checkout, seguimiento y panel de pedidos (`/m/[slug]/pedido`, `/pedido/[token]`, `/app`) esperan a T21–T23; los avisos por WhatsApp, a T24–T25. Siguen simulados en `demo.ts` hasta entonces.

[^task-13]: Integrada en el [PR #52](https://github.com/Draggodeidad/menu-max/pull/52) (`feat/t13-pantalla-invitacion`). La task-08 se integró en el PR #29.

[^15]: Integrada en el [PR #72](https://github.com/Draggodeidad/menu-max/pull/72) (`fix/20-aviso-cuenta-existente`).
