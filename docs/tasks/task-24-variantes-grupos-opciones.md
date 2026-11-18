# Task 24 — Catálogo: variantes y grupos de opciones

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-23

> No confundir con la task T24 del backend. Consume T16. Matriz: `PARIDAD-API.md` § Catálogo e imágenes y § Lo que la UI tiene y la API no.

## Contexto

La API distingue dos cosas que la UI hoy mezcla en una sola «opción» con «costo extra» y una casilla para activarla:

- **Variantes** (`variants`): tamaño o presentación. Cada una tiene su propio precio (`priceCents`), que reemplaza el del producto, y el comensal elige una. Hasta 20 por producto.
- **Grupos de opciones** (`optionGroups`): salsas o extras. Cada grupo tiene `minSelect` y `maxSelect`, y sus opciones suman `priceDeltaCents` al precio (nunca restan). Hasta 10 grupos de 30 opciones.

En `PATCH /products/{id}`, `variants` y `optionGroups` reemplazan la lista completa, y los ids cambian. Si se omiten, no cambian.

La API no guarda disponibilidad por variante. Por la regla de `PARIDAD-API.md`, la casilla «activa» de la UI se quita: la disponibilidad es del producto (task-23).

## Campos y validaciones

| Control                                  | Contrato                               | Mensaje del contrato              |
| ---------------------------------------- | -------------------------------------- | --------------------------------- |
| Variante: nombre                         | `VariantInput.name` 1–80               | —                                 |
| Variante: precio                         | `VariantInput.priceCents` 0–10,000,000 | —                                 |
| Variantes por producto                   | ≤ 20 (`MAX_VARIANTS_PER_PRODUCT`)      | —                                 |
| Grupo: nombre                            | `OptionGroupInput.name` 1–80           | —                                 |
| Grupo: mínimo                            | `minSelect` 0–30                       | `MIN_ABOVE_MAX` si pasa el máximo |
| Grupo: máximo                            | `maxSelect` 1–30, ≤ número de opciones | `MAX_ABOVE_OPTIONS`               |
| Opción: nombre                           | `OptionInput.name` 1–80                | —                                 |
| Opción: costo extra                      | `priceDeltaCents` 0–10,000,000         | —                                 |
| Grupos por producto · opciones por grupo | ≤ 10 · 1–30                            | —                                 |
| Orden                                    | Orden de la lista                      | —                                 |

## Archivos involucrados

- `apps/web/src/routes/app/catalogo/ProductoFila.svelte` y `+page.server.ts`: se quitan `agregarVariante` y `alternarVariante` y entran las actions nuevas.
- `apps/web/DESIGN.md §7.1 E` y §6: el editor y sus textos («Tamaños y precios», «Extras», «Elige de … a …»).
- `e2e/`: proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md`.** El editor vive dentro de la fila del producto, en un `<details>` «Tamaños y extras», sin modal. Tiene dos bloques:
   - **Variantes:** filas de nombre y precio, «Agregar tamaño», quitar y subir o bajar. Con variantes, el precio del producto se muestra como «Desde $X».
   - **Grupos de opciones:** nombre, «Mínimo» y «Máximo» (con ayuda: «Elige de 0 a 2»), y sus opciones con nombre y costo extra.
2. **Guardar.** Un botón «Guardar cambios» por bloque manda la lista completa (`variants` u `optionGroups`) con la `version` del producto. Las reglas se validan con el contrato antes de enviar. Los errores con ruta (`optionGroups.1.maxSelect`) se muestran bajo su control.
3. **Quitar lo que la API no soporta.** Se quitan la casilla «activa» por variante y el «costo extra» de las variantes: ese valor pasa a ser una opción.

## Criterios de aceptación

- [ ] Un producto con 3 tamaños y un grupo «Salsas» (mínimo 0, máximo 2, 4 opciones) se guarda y se ve igual al recargar y en `GET /v1/public/menus/{slug}`.
- [ ] Mínimo mayor que máximo, o máximo mayor que el número de opciones → mensaje del contrato bajo el campo, sin llamar a la API.
- [ ] El tope de 20 variantes, 10 grupos y 30 opciones se respeta en la UI.
- [ ] Ya no existe ningún control que la API no guarde.
- [ ] Un `409` por `version` vieja recarga el producto y avisa.
- [ ] 360px y teclado revisados.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Elegir variante y opciones en el menú público: task-33.
