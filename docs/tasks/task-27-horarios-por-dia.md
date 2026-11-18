# Task 27 — Horarios por día

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-26

> No confundir con la task T27 del backend. Consume T15 (horarios). Matriz: `PARIDAD-API.md` § Horarios y zonas.

## Contexto

La sección Servicio tiene una sola hora de apertura y una de cierre. La API guarda la semana completa:

- `PUT /v1/orgs/{orgId}/branches/{branchId}/hours` con `ReplaceHoursInput { ranges: [{ weekday, opensAt, closesAt }] }`. Reemplaza la semana anterior.
- `weekday`: 0 = domingo … 6 = sábado.
- `opensAt`: `HH:MM` de 00:00 a 23:59. `closesAt`: de 00:00 a 24:00.
- Apertura y cierre iguales → `SAME_OPEN_CLOSE`.
- Si `opensAt` es mayor que `closesAt`, el rango cruza la medianoche y la API lo guarda partido en dos días.
- Hasta 50 rangos. Una lista vacía = sucursal sin horario, siempre cerrada.
- `GET /branches/{branchId}` devuelve `hours: HoursRangeDto[]`, ordenados y sin cruces de medianoche.

El menú público usa estos rangos para `isOpen`, `todayHours` y `nextOpening`, en la zona horaria de la sucursal.

## Campos y validaciones

| Control                                                                                  | Contrato                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Siete filas (lunes a domingo, en ese orden en pantalla) con «Cerrado» o uno o más rangos | `weekday` 0–6                                                                                                            |
| Abre (`<input type="time">`)                                                             | `OpensAt`                                                                                                                |
| Cierra (`<input type="time">`; se acepta 24:00 como «medianoche»)                        | `ClosesAt`                                                                                                               |
| «Agregar horario» en el mismo día (por ejemplo, 13:00–16:00 y 19:00–23:00)               | ≤ 50 rangos en total                                                                                                     |
| «Copiar a todos los días»                                                                | — (ayuda de captura, no cambia el contrato)                                                                              |
| Cierra después de medianoche (22:00–02:00)                                               | Se envía tal cual; al recargar se ve como dos rangos, y la UI explica «Sigue abierto hasta las 02:00 del día siguiente». |

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/SeccionServicio.svelte` y `+page.server.ts`: se quitan `abre` y `cierra` únicos.
- `apps/web/DESIGN.md §7.1 F` y §6.
- `e2e/`: proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md`.** Bloque «Horario» con las siete filas, un `Switch` «Abierto» por día y sus rangos. En móvil, una columna.
2. **Leer.** Agrupar `hours` por día. Juntar en pantalla los dos rangos que la API partió por cruzar la medianoche (cierre 24:00 seguido de apertura 00:00 al día siguiente) para que se lean como uno.
3. **Guardar.** «Guardar cambios» manda la semana completa, validada con `ReplaceHoursInput`. Cada error con ruta (`ranges.4.closesAt`) se muestra bajo su rango.
4. **Vista previa.** Debajo, «Hoy: abierto de 13:00 a 23:00» con la misma lógica del menú público, para que el dueño vea lo mismo que el comensal.

## Criterios de aceptación

- [ ] Un horario distinto por día, con dos rangos el sábado y el domingo cerrado, se guarda y persiste.
- [ ] 22:00–02:00 se guarda, se muestra como un rango y el menú público dice abierto a la 01:00 del día siguiente.
- [ ] Apertura igual al cierre → `SAME_OPEN_CLOSE` bajo el rango, sin llamar a la API.
- [ ] Todos los días cerrados → lista vacía; el menú público queda cerrado sin `nextOpening`.
- [ ] Teclado y 360px revisados.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Días festivos o cierres temporales: la API no los soporta.
