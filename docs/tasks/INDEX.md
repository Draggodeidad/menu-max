# Backlog de auditoría frontend

El alcance es exclusivamente el frontend con datos simulados. Cada tarea indica cómo reactivar sus pruebas `test.fixme`; no se debe modificar `apps/api`, configurar servicios remotos ni dar por existente una API. Leer `apps/web/AGENTS.md` y `apps/web/DESIGN.md` antes de implementar. El orden desempata tareas con la misma prioridad y reduce conflictos entre archivos.

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

Para cualquier tarea, primero reproducir el test indicado quitando exclusivamente su marca `fixme`, implementar y volver a ejecutar toda la suite. Cuando un test forma parte de un bucle, eliminar la condición `test.fixme` específica de ese caso y conservar los demás. Las dependencias son funcionales o de archivos compartidos, no autorización para desplegar ni integrar cambios directamente en `main`.

[^task-13]: En revisión en `feat/t13-pantalla-invitacion` ([PR #52](https://github.com/Draggodeidad/menu-max/pull/52)). La task-08 se integró en el PR #29.
