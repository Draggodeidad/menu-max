# Task 28 — Zonas de entrega por código postal

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-26

> No confundir con la task T28 del backend. Consume T15 y ADR-018. Matriz: `PARIDAD-API.md` § Horarios y zonas.

## Contexto

La sección Zonas pide nombre («Colonias de la zona») y costo, y guarda la lista entera de una vez. La API maneja cada zona por separado, con códigos postales (ADR-018):

| Ruta (bajo `/branches/{branchId}`) | Contrato                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /zones`                       | `DeliveryZoneListDto { items }`: zonas no borradas, ≤ 20, con `postalCodes`, `feeCents`, `active` y `version` |
| `POST /zones`                      | `CreateDeliveryZoneInput { name, postalCodes, feeCents, active? }`                                            |
| `PATCH /zones/{zoneId}`            | `UpdateDeliveryZoneInput` parcial con `version`; `active: false` pausa la zona                                |
| `DELETE /zones/{zoneId}`           | Borrado lógico. Una zona borrada no vuelve                                                                    |

Un mismo código postal no puede estar en dos zonas activas de la sucursal: `409 CONFLICT`, con el código repetido en `fieldErrors`. A domicilio solo aparece en el menú público si `mode_delivery` está activo y hay al menos una zona activa.

## Campos y validaciones

| Control                  | Contrato                                       | Mensaje                                             |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------- |
| Nombre de la zona        | `name` 1–120                                   | —                                                   |
| Códigos postales (nuevo) | `postalCodes`: 1–100 de 5 dígitos, sin repetir | `PostalCode`; `DUPLICATE_POSTAL_CODE`               |
| Costo de envío           | `feeCents` 0–1,000,000 ($0 = «Envío gratis»)   | —                                                   |
| Activa (nuevo)           | `active`                                       | `Switch` «Activa» / «Pausada»                       |
| Borrar (nuevo)           | `DELETE`                                       | `AlertDialog`: «Borrar zona. No se puede deshacer.» |
| Zonas por sucursal       | ≤ 20 (`MAX_ZONES_PER_BRANCH`)                  | «Agregar zona» se deshabilita en 20                 |

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/SeccionZonas.svelte` y `+page.server.ts`: la action `zonas` se reemplaza por `crearZona`, `editarZona` y `borrarZona`.
- `apps/web/DESIGN.md §7.1 F` y §6.
- `e2e/`: proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md`.** Cada zona es una fila con nombre, costo y estado. Al editarla:
   - se capturan los códigos postales separados por coma o espacio (se muestran como chips `rounded-full`);
   - hay un contador «12 de 100».
2. **Captura.** Normalizar en la action (recortar, separar, quitar vacíos) y validar con el contrato. Un código inválido o repetido se marca en su chip.
3. **Conflicto entre zonas.** El `409` con `fieldErrors` señala el código que ya usa otra zona activa, con el nombre de esa zona si se puede leer de la lista.
4. **Rol.** Sin `settings:write`, solo lectura.

## Criterios de aceptación

- [ ] Crear, editar, pausar, reactivar y borrar una zona persiste en la API.
- [ ] Un código con 4 dígitos o repetido en la zona → mensaje del contrato sin llamar a la API.
- [ ] El mismo código en dos zonas activas → `409` señalado en el chip.
- [ ] Con 20 zonas, «Agregar zona» se deshabilita.
- [ ] El menú público muestra solo las zonas activas, con nombre y tarifa («Envío gratis» si es $0) y sin códigos postales. A domicilio desaparece si no queda ninguna activa.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Pedir el código postal del comensal en el checkout: llega con los pedidos (backend T21).
