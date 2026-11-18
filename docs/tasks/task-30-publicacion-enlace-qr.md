# Task 30 — Publicación, enlace y QR

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-18, task-19

> No confundir con la task T30 del backend (no existe). Consume T18 (slug y publicación) y T19 (QR, ADR-017). Matriz: `PARIDAD-API.md` § Menú público, tema, publicación y QR.

## Contexto

El alta deja el menú publicado (task-19), pero el panel no permite despublicarlo, volver a publicarlo, elegir su enlace ni ver su estado. La sección QR está simulada. La API tiene, bajo `/branches/{branchId}`:

| Ruta                                          | Contrato                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /menu`                                   | `MenuDto.status` (`draft`, `published`), `slug`, `publishedAt`                                                    |
| `POST /menu/publish` · `POST /menu/unpublish` | `MenuPublicationDto`. Despublicado, el menú público responde `404` y el QR también deja de servir                 |
| `PATCH /menu/slug`                            | `UpdateSlugInput { slug }`, solo mientras el menú **nunca** se publicó (después → `422`). Ver la regla abajo      |
| `GET /qr` · `GET /qr?mesa=n`                  | SVG del menú o de la mesa `n` (1 a `tableCount`). Sin publicar → `422 BUSINESS_RULE`; mesa fuera de rango → `400` |

Regla del slug: 3–50 caracteres, `SLUG_PATTERN`, fuera de `RESERVED_SLUGS`. Mensajes `SLUG_FORMAT_MESSAGE` y `SLUG_RESERVED_MESSAGE`. Si otro menú ya lo usa → `409`.

## Campos y validaciones

| Control                                                                                                                 | Contrato                |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Estado: «Publicado desde el {fecha}» o «Borrador»                                                                       | `status`, `publishedAt` |
| «Despublicar menú» (`AlertDialog`: «Tu menú dejará de verse y tus QR no abrirán nada hasta que lo publiques de nuevo.») | `POST /menu/unpublish`  |
| «Publicar menú»                                                                                                         | `POST /menu/publish`    |
| Enlace `menusmax.mx/m/[slug]`, editable solo si nunca se publicó                                                        | `PATCH /menu/slug`      |
| «Copiar enlace»                                                                                                         | `slug`                  |
| QR del menú y selector de mesa (1 a `tableCount`), con «Descargar QR» (SVG)                                             | `GET /qr`, `?mesa=n`    |

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/SeccionQr.svelte` y `+page.server.ts`. Las mesas pasan a task-26.
- `apps/web/src/routes/app/listo/`: usa el mismo QR (task-19).
- `apps/web/DESIGN.md §7.1 F` y §6: sección «Publicación y QR».
- `e2e/`: proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md`.** La sección muestra:
   - el estado y el enlace;
   - el QR grande del menú;
   - el selector de mesa;
   - «Descargar QR» y «Copiar enlace»;
   - «Despublicar menú» como acción secundaria con confirmación.
2. **QR.** El SVG de la API se pinta con `{@html}` (`AGENTS.md §5`). «Descargar» sirve el mismo SVG con `content-disposition` desde una action o un endpoint del servidor de WEB, sin `fetch` del cliente a la API.
3. **Errores.**
   - `422` del QR → «Publica tu menú para ver su QR.»;
   - `409` del slug → bajo el campo;
   - `422` del slug → el campo se vuelve de solo lectura.
4. **Rol.** Sin `storefront:publish`, la sección es de solo lectura (QR y enlace visibles).

## Criterios de aceptación

- [ ] Despublicar → el menú público responde `404` y el QR muestra «Publica tu menú…»; publicar lo restablece.
- [ ] Un menú nunca publicado permite cambiar el enlace con las reglas del contrato; uno ya publicado no.
- [ ] Un slug reservado, mal formado o tomado muestra su mensaje.
- [ ] El QR de cada mesa abre `/m/{slug}?mesa=n`, y una mesa fuera de rango no se ofrece.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- PNG o PDF para imprimir: ADR-017 los deja fuera del MVP.
