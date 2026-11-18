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

## Integración y paridad con la API (task-16 a task-33)

**La API es la única fuente de verdad y dicta el alcance del frontend.** Todo lo que la API ya soporta (endpoints, campos, parámetros, validaciones y estados) tiene su control en la interfaz y una task que lo conecta, aunque hoy no exista en el diseño. La auditoría completa y la regla están en [`PARIDAD-API.md`](PARIDAD-API.md).

- task-16 cambia `apps/web/AGENTS.md §0.1` a la fase de integración; hasta entonces rige la fase con datos simulados.
- Las validaciones salen de `@menu-max/contracts`. La UI no inventa reglas más estrictas ni más laxas que el contrato.
- Si una task agrega un control que `DESIGN.md` no tiene, actualiza `DESIGN.md` en la misma task.
- Lo que la UI tiene y la API no se adapta: si el backend lo tiene planeado (pedidos, WhatsApp), sigue simulado con `// TEMPORAL`; si no, se quita.
- Una pantalla conectada borra sus mocks de `demo.ts` en la misma task.
- Las pruebas corren en el proyecto `integracion` de Playwright, contra `apps/api` local con D1 local. Nunca contra staging ni producción.
- Ninguna task modifica `apps/api` ni `packages/contracts`. Lo que falta en el contrato está en «Pedidos al backend» de `PARIDAD-API.md`, cada uno en su propio PR.

| Orden | Tarea                                                                                                         | Prioridad | Depende de                                     | Backend que consume  |
| ----- | ------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------- | -------------------- |
| 16    | [task-16 — Base para integrar la API](task-16-base-integracion-api.md)                                        | P0        | task-01 a task-15                              | T05, T07, T09        |
| 17    | [task-17 — Sesión real, `/entrar` y «Salir»](task-17-sesion-entrar-salir.md)                                  | P0        | task-16                                        | T07, T09, T11        |
| 18    | [task-18 — Organización y sucursal activas, y permisos por rol](task-18-organizacion-sucursal-permisos.md)    | P0        | task-17; pedido al backend n.º 1               | T11, T12, T15        |
| 19    | [task-19 — `/crear` y `/app/listo` con `POST /v1/onboarding`](task-19-crear-con-onboarding.md)                | P0        | task-16, task-17                               | T18, T19, T20, T20c  |
| 20    | [task-20 — Verificar el correo y reenviar el enlace](task-20-verificar-correo.md)                             | P0        | task-17, task-19                               | T10                  |
| 21    | [task-21 — Restablecer y cambiar la contraseña](task-21-contrasena-restablecer-cambiar.md)                    | P1        | task-16, task-17                               | T09, T10             |
| 22    | [task-22 — `/invitacion` con la API](task-22-invitacion-con-api.md)                                           | P1        | task-16, task-17, task-18                      | T09, T13             |
| 23    | [task-23 — Catálogo: categorías y productos](task-23-catalogo-categorias-productos.md)                        | P1        | task-18, task-19                               | T14, T16             |
| 24    | [task-24 — Catálogo: variantes y grupos de opciones](task-24-variantes-grupos-opciones.md)                    | P1        | task-23                                        | T16                  |
| 25    | [task-25 — Imágenes: foto de producto, logo y portada](task-25-imagenes-con-api.md)                           | P1        | task-23                                        | T17, T18             |
| 26    | [task-26 — Negocio y sucursales](task-26-negocio-sucursales.md)                                               | P1        | task-18                                        | T14, T15             |
| 27    | [task-27 — Horarios por día](task-27-horarios-por-dia.md)                                                     | P1        | task-26                                        | T15                  |
| 28    | [task-28 — Zonas de entrega por código postal](task-28-zonas-de-entrega.md)                                   | P1        | task-26                                        | T15 (ADR-018)        |
| 29    | [task-29 — Tema completo del menú](task-29-tema-completo.md)                                                  | P1        | task-25, task-32                               | T14b, T18            |
| 30    | [task-30 — Publicación, enlace y QR](task-30-publicacion-enlace-qr.md)                                        | P1        | task-18, task-19                               | T18, T19             |
| 31    | [task-31 — Equipo: miembros, sucursales del personal e invitaciones](task-31-equipo-miembros-invitaciones.md) | P1        | task-18, task-20                               | T12, T13, T14        |
| 32    | [task-32 — Plan, uso y suscripción suspendida](task-32-plan-suscripcion.md)                                   | P1        | task-18                                        | T14, T14b, T20, T20b |
| 33    | [task-33 — Menú público con `PublicMenuDto` completo](task-33-menu-publico-con-api.md)                        | P1        | task-16, task-24; pedidos al backend n.º 2 y 3 | T18 (ADR-014)        |

Criterios de cierre de las fases del backend:

- task-16 cumple el de B1 (WEB llama a `/v1/health` por Service Binding);
- task-20, el de B2, salvo el correo real (Resend, pendiente de un humano);
- task-19, el de B4.

**Sin task, porque la API todavía no lo soporta:** checkout, seguimiento y panel de pedidos (`/m/[slug]/pedido`, `/pedido/[token]`, `/app`) esperan a T21–T23; los avisos por WhatsApp, a T24–T25. Siguen simulados en `demo.ts`. Cuando el backend entregue cada fase, sus tasks de paridad se generan con [`PROMPT-PARIDAD.md`](PROMPT-PARIDAD.md).

[^task-13]: Integrada en el [PR #52](https://github.com/Draggodeidad/menu-max/pull/52) (`feat/t13-pantalla-invitacion`). La task-08 se integró en el PR #29.

[^15]: Integrada en el [PR #72](https://github.com/Draggodeidad/menu-max/pull/72) (`fix/20-aviso-cuenta-existente`).
