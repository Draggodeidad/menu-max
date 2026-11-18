# Task 22 — `/app/catalogo` con la API

**Prioridad:** P1
**Categoría:** Integración con la API
**Depende de:** task-17, task-18

> No confundir con la task T22 del backend. Esta task consume T16 (catálogo con `version` y borrado lógico), T17 (imágenes en R2) y T14 (límites del plan).

## Contexto

`/app/catalogo` (`DESIGN.md §7.1 E`) guarda sus cambios en una cookie (`// TEMPORAL`). Sus actions son `guardar`, `eliminar`, `agregarProducto`, `agregarCategoria`, `eliminarCategoria`, `moverCategoria`, `agregarVariante`, `alternarVariante` y `subirFoto`.

La API ya tiene, bajo `/v1/orgs/{orgId}/branches/{branchId}/menu`:

| Método              | Ruta                                                   | Para qué                                                                                                |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| GET                 | `/`                                                    | `MenuDto`: categorías con sus productos, variantes y grupos de opciones; cada uno con `version`         |
| POST, PATCH, DELETE | `/categories`, `/categories/{id}`                      | Crear, renombrar y borrar (lógico)                                                                      |
| PUT                 | `/categories/order`, `/categories/{id}/products/order` | Reordenar                                                                                               |
| POST, PATCH, DELETE | `/products`, `/products/{id}`                          | `UpdateProductInput` es parcial con `version`; `variants` y `optionGroups` reemplazan la lista completa |
| PATCH               | `/products/{id}/availability`                          | Disponible o agotado, con `version`                                                                     |

La foto se sube con `POST /v1/orgs/{orgId}/media`:

- el cuerpo es la imagen cruda (`image/jpeg`, `image/png` o `image/webp`), de hasta 5 MB y 6000 px por lado;
- devuelve `MediaAssetDto`, y se liga al producto con `PATCH /products/{id}` `{ imageAssetId }`.

Errores relevantes:

- `409 CONFLICT`: la `version` es vieja, otro miembro editó antes;
- `402 PLAN_LIMIT_REACHED`: más productos que el plan;
- `413`: la imagen es demasiado grande;
- `403`: el rol no tiene `catalog:write` (`staff` solo cambia la disponibilidad).

## Objetivo

Todo lo que se edita en el catálogo se guarda en la API y se ve en el menú público. Un conflicto de edición no pierde datos sin avisar.

## Archivos involucrados

- `apps/web/src/routes/app/catalogo/+page.server.ts` y `+page.svelte`.
- `apps/web/src/lib/server/demo.ts`: se borra el catálogo simulado del panel.
- `e2e/`: las pruebas del catálogo pasan al proyecto `integracion`.

## Pasos sugeridos

1. **`load`.** Lee `MenuDto` y lo mapea a la forma que ya usa la pantalla. Cada fila lleva su `version` en un `<input type="hidden">`.
2. **Actions.** Cada una llama a su ruta con `apiAction` y la `version` de la fila:
   - `guardar` → `PATCH /products/{id}` (precio) y `PATCH …/availability` (disponible);
   - `agregarProducto` y `agregarCategoria` → `POST`;
   - `eliminar` y `eliminarCategoria` → `DELETE`;
   - `moverCategoria` → `PUT /categories/order`;
   - `agregarVariante` → `PATCH /products/{id}` con la lista completa de `variants`.
3. **Conflictos.** `409` → el mensaje de la API en la fila y los datos recién leídos de la API, sin reintentar en automático.
4. **Límites del plan.** `402` → el mensaje de la API junto a «Agregar producto».
5. **Fotos.** `subirFoto`:
   - valida tipo y tamaño en la action antes de reenviar (ya lo hace);
   - sube el archivo crudo a `/media` con su `content-type`;
   - liga el `id` con `PATCH /products/{id}`.

   La URL de la imagen la entrega la API (`imageUrl`); WEB no arma rutas de R2.

6. **Rol `staff`.** Solo ve el control de disponibilidad, como pide la matriz de ADR-007. Si la UI no lo distingue hoy, se oculta lo demás según `role` (task-17).

## Dudas a resolver antes de empezar

- **Activar o desactivar una variante.** WEB tiene `alternarVariante`, pero la API no guarda disponibilidad por variante: `VariantInput` es `{ name, priceCents }`. Opciones:
  - (a) quitar el control de la UI y que «Agotado» aplique al producto completo;
  - (b) pedir al backend una task que agregue disponibilidad por variante (contrato + migración).

  Recomendación: (a) para el piloto, y anotarlo en `DESIGN.md`.

- **Grupos de opciones.** La API los soporta (`optionGroups`), pero la pantalla no los edita. Recomendación: dejarlos fuera de esta task y conservar los que ya existan al guardar. Como el `PATCH` es parcial, basta con no mandar `optionGroups`.

## Criterios de aceptación

- [ ] Cambiar precio o disponibilidad se guarda en la API y se ve en `GET /v1/public/menus/{slug}`.
- [ ] Agregar, borrar y reordenar categorías y productos persiste al recargar.
- [ ] Dos pestañas editando el mismo producto: la segunda recibe el aviso de conflicto con los datos nuevos.
- [ ] Superar el límite de productos del plan muestra el mensaje `PLAN_LIMIT_REACHED` de la API.
- [ ] Subir una foto válida la muestra en el panel y en el menú público; una de más de 5 MB muestra el error.
- [ ] Un miembro `staff` solo puede cambiar la disponibilidad.
- [ ] `demo.ts` ya no tiene el catálogo del panel.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- El menú público: task-24.
- Editar grupos de opciones: no está en `DESIGN.md`.
