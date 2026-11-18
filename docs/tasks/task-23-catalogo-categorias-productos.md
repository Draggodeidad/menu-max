# Task 23 — Catálogo: categorías y productos con la API

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-18, task-19

> No confundir con la task T23 del backend. Consume T16 (catálogo con `version` y borrado lógico) y T14 (límite de productos). Matriz: `PARIDAD-API.md` § Catálogo e imágenes.

## Contexto

`/app/catalogo` (`DESIGN.md §7.1 E`) guarda en una cookie. Hoy permite crear y borrar categorías, moverlas, y editar precio y disponibilidad. Bajo `/v1/orgs/{orgId}/branches/{branchId}/menu`, la API también soporta renombrar, describir, mover de categoría y reordenar productos:

| Ruta                                                                      | Contrato                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /`                                                                   | `MenuDto`: categorías con productos (incluye los agotados, nunca los borrados), cada uno con `version`        |
| `POST /categories` · `PATCH /categories/{id}` · `DELETE /categories/{id}` | `CreateCategoryInput { name }`; `UpdateCategoryInput { version, name }`; ≤ 100 categorías                     |
| `PUT /categories/order` · `PUT /categories/{id}/products/order`           | `ReorderInput { ids }`: lista completa sin repetidos. Si falta o sobra un id → `409`                          |
| `POST /products`                                                          | `CreateProductInput { categoryId, name, description?, priceCents, available? }` (variantes y grupos: task-24) |
| `PATCH /products/{id}`                                                    | `UpdateProductInput` parcial con `version`. Cambiar `categoryId` lo mueve al final de esa categoría           |
| `PATCH /products/{id}/availability`                                       | `{ version, available }`. Es lo único que puede `staff`                                                       |
| `DELETE /products/{id}`                                                   | Borrado lógico                                                                                                |

Errores:

- `409 CONFLICT`: `version` vieja o lista de orden desactualizada;
- `402 PLAN_LIMIT_REACHED`: más productos que `maxProducts`, contando toda la organización;
- `403`: rol sin `catalog:write`.

## Campos y validaciones

| Control                | Contrato                                                             | Hoy             | Cambio                               |
| ---------------------- | -------------------------------------------------------------------- | --------------- | ------------------------------------ |
| Nombre de categoría    | `CatalogName` 1–80                                                   | Solo al crear   | Editable en línea («Guardar»)        |
| Orden de categorías    | `PUT /categories/order`                                              | Subir y bajar   | Conectar                             |
| Nombre de producto     | `CatalogName` 1–80                                                   | Solo al crear   | Editable en la fila                  |
| Descripción            | `description` ≤ 500, admite saltos de línea; vacía = sin descripción | Solo se muestra | `<textarea>` con contador            |
| Precio                 | `priceCents` 0–10,000,000                                            | > $0            | Se acepta $0                         |
| Disponible             | `available` (por `/availability`)                                    | Casilla         | Conectar; único control de `staff`   |
| Categoría del producto | `categoryId`                                                         | No existe       | Selector «Mover a…»                  |
| Orden de productos     | `PUT /categories/{id}/products/order`                                | No existe       | Subir y bajar dentro de la categoría |

## Archivos involucrados

- `apps/web/src/routes/app/catalogo/+page.server.ts`, `+page.svelte`, `CategoriaSeccion.svelte`, `ProductoFila.svelte` y `ConfirmarEliminar.svelte`.
- `apps/web/src/lib/server/demo.ts`: se borra el catálogo simulado del panel.
- `apps/web/DESIGN.md §7.1 E`: renombrar, descripción, mover y reordenar productos.
- `e2e/`: pruebas del catálogo en el proyecto `integracion`.

## Pasos sugeridos

1. **`load`.** Lee `MenuDto` de la sucursal activa (task-18). Cada fila lleva `version` en un campo oculto.
2. **Actions.** Una por ruta, validadas con su esquema. Reordenar manda la lista completa de ids tal como está en pantalla.
3. **Errores.**
   - `409` → aviso en la fila o la categoría y datos recién leídos;
   - `402` → mensaje de la API junto a «Agregar producto», con el uso y el límite de la sección «Plan» (task-32).
4. **Rol.** Con el helper de task-18, `staff` solo ve la casilla de disponibilidad.

## Criterios de aceptación

- [ ] Cada fila de la tabla de campos se guarda en la API y persiste al recargar.
- [ ] El menú público refleja nombres, descripciones, orden, precios ($0 incluido) y disponibilidad.
- [ ] Dos pestañas editando lo mismo: la segunda ve el aviso de conflicto con los datos nuevos.
- [ ] Pasar el límite de productos del plan → mensaje `PLAN_LIMIT_REACHED`.
- [ ] Un `staff` solo cambia la disponibilidad.
- [ ] `demo.ts` ya no tiene el catálogo del panel.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Variantes y grupos de opciones: task-24.
- Fotos: task-25.
