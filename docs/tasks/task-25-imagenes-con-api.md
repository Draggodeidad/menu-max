# Task 25 — Imágenes: foto de producto, logo y portada

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-23

> No confundir con la task T25 del backend. Consume T17 (R2 con _magic bytes_) y T18 (`logoAssetId`, `coverAssetId`). Matriz: `PARIDAD-API.md` § Catálogo e imágenes.

## Contexto

`subirFoto` valida y simula la foto del producto. No hay logo ni portada, ni forma de quitar una imagen.

| Ruta                                      | Contrato                                                                                                                                                                                                                                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/orgs/{orgId}/media`             | Cuerpo: el archivo crudo con su `content-type`, `image/jpeg`, `image/png` o `image/webp` (el tipo real se lee de los primeros bytes). Hasta 5 MB (`MAX_MEDIA_BYTES`) y 6000 px por lado (`MAX_MEDIA_SIDE`). 60 subidas por hora por organización. `201` → `MediaAssetDto { id, url, width, height }` |
| `DELETE /v1/orgs/{orgId}/media/{mediaId}` | `204`. Si la imagen sigue ligada a un producto o al tema → `422 BUSINESS_RULE`: primero se desliga, luego se borra                                                                                                                                                                                   |
| `PATCH …/products/{id}`                   | `imageAssetId` (uuid o `null` para quitarla)                                                                                                                                                                                                                                                         |
| `PUT …/menu/theme`                        | `logoAssetId` y `coverAssetId` (uuid o `null`)                                                                                                                                                                                                                                                       |

Errores: `400` (tipo no válido), `413` (demasiado grande) y `429`.

## Objetivo

Subir, cambiar y quitar la foto de un producto y el logo y la portada del menú. Las URLs siempre las da la API.

## Archivos involucrados

- `apps/web/src/lib/components/ImageUpload.svelte` (nuevo: lo usan catálogo y ajustes). Tiene vista previa, «Cambiar» y «Quitar».
- `apps/web/src/routes/app/catalogo/ProductoFila.svelte` y `+page.server.ts`.
- `apps/web/src/routes/app/ajustes/SeccionTema.svelte` y `+page.server.ts`: logo y portada. task-29 completa el resto del tema.
- `apps/web/DESIGN.md §6` y §7.1 E y F.
- `e2e/`: proyecto `integracion`, con imágenes de prueba pequeñas.

## Pasos sugeridos

1. **Componente.** `<input type="file" accept="image/jpeg,image/png,image/webp">` y vista previa local. El tipo y el tamaño se validan en la action con las constantes del contrato antes de reenviar.
2. **Subir y ligar.** La action:
   - sube a `/media`;
   - liga el `id` con `PATCH` del producto o `PUT` del tema;
   - borra el asset anterior (`DELETE /media/{id}`) después de ligar el nuevo.

   Si ligar falla, borra el recién subido.

3. **Quitar.** Liga `null` y borra el asset.
4. **Errores.** `400`, `413` y `429` muestran el mensaje de la API bajo el control. El `413` dice el límite en MB.
5. **Imagen en pantalla.** `width`, `height`, `alt` (nombre del producto o «Logo de {negocio}»), `loading="lazy"` y `decoding="async"`, salvo la portada (`AGENTS.md §6.5`).

## Criterios de aceptación

- [ ] Subir, cambiar y quitar funcionan para producto, logo y portada; el menú público lo refleja.
- [ ] Un archivo que no es imagen, aunque se llame `.jpg`, muestra el `400` de la API.
- [ ] Más de 5 MB → mensaje sin llamar a la API; si llega a la API, su `413`.
- [ ] Ningún asset queda huérfano al cambiar o quitar una imagen.
- [ ] La UI nunca arma URLs de R2.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Recortar o redimensionar: la API guarda el archivo tal cual.
