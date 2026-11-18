# Task 33 — Menú público con `PublicMenuDto` completo

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-16, task-24 · **Bloqueada en parte por:** los pedidos al backend n.º 2 (slug del ejemplo) y n.º 3 (TTL de ADR-014) de `PARIDAD-API.md`

> No confundir con la task T33 del backend (no existe). Consume T18 (lectura pública, `menuVersion`) y ADR-014. Matriz: `PARIDAD-API.md` § Menú público, tema, publicación y QR.

## Contexto

`/m/[slug]` (`DESIGN.md §7.2 I`) arma el menú desde `demo.ts`, con una sola lista de «opciones» sin precio por producto. La API entrega `GET /v1/public/menus/{slug}` → `PublicMenuDto`; un slug inexistente o un menú en borrador → `404`.

| Dato                                      | Contrato                                                                                                              | Hoy en la UI                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Negocio y sucursal                        | `business.name`, `branch.name`, `timezone`                                                                            | Nombre simulado                                                                                                        |
| Teléfono                                  | `branch.contactPhone`                                                                                                 | No existe → «Llamar al negocio» (`tel:`) en la cabecera                                                                |
| Horario de hoy, abierto, próxima apertura | `todayHours`, `isOpen`, `nextOpening`                                                                                 | Simulado → mostrar los rangos de hoy y «Abre hoy a las 19:00» o «Abre el martes a las 13:00»                           |
| Modalidades y mesas                       | `modes`, `tableCount`                                                                                                 | Simuladas                                                                                                              |
| Zonas de entrega                          | `deliveryZones[{ name, feeCents }]`                                                                                   | No existe → lista «Envío a domicilio» con tarifa o «Envío gratis»                                                      |
| Tema efectivo                             | `primaryColor`, `backgroundColor`, `textColor`, `fontPreset`, `productLayout` (`list`, `grid`), `logoUrl`, `coverUrl` | Parcial → todo, con los derivados de `DESIGN.md §3.6`                                                                  |
| Sello                                     | `showBranding`                                                                                                        | No existe → «Hecho con MenusMax» al pie                                                                                |
| Producto                                  | `name`, `description`, `priceCents`, `imageUrl`, `imageWidth`, `imageHeight`                                          | Sin descripción real ni medidas                                                                                        |
| Variantes                                 | `variants[{ id, name, priceCents }]`                                                                                  | No existe → radio obligatorio; precio «Desde $X»                                                                       |
| Grupos de opciones                        | `optionGroups[{ id, name, minSelect, maxSelect, options[{ id, name, priceDeltaCents }] }]`                            | Un solo radio sin precio → radio si `maxSelect` = 1, casillas si es mayor; respetar mínimo y máximo; «+ $5» por opción |
| Estado                                    | `acceptingOrders`, `notAcceptingReason` (`closed`, `unverified`, `suspended`, `inactive`)                             | Ya diseñado en `DESIGN.md §7.2`                                                                                        |
| Versión                                   | `menuVersion` y `GET …/{slug}/version`                                                                                | No existe → caché de ADR-014                                                                                           |

## Objetivo

El QR impreso abre el menú real, con todo lo que la API publica, y el comensal arma su pedido con las mismas reglas de variantes y opciones que guarda el catálogo.

## Archivos involucrados

- `apps/web/src/routes/m/[slug]/+layout.server.ts`, `+layout.svelte`, `+page.server.ts` y `+page.svelte`.
- `apps/web/src/lib/components/MenuView.svelte`: variantes, grupos con mínimo y máximo, descripción, medidas de imagen, zonas, teléfono y sello.
- `apps/web/src/lib/cart.svelte.ts`: el artículo guarda `variantId` y `optionIds`, y su precio se calcula como en la API (variante o precio base, más los deltas). Es solo para mostrar: el checkout no manda precios.
- `apps/web/src/lib/server/demo.ts`: se borra el menú simulado, salvo el negocio de ejemplo (ver «Pedidos»).
- `apps/web/DESIGN.md §7.2 I` y §6: variantes, extras, teléfono, zonas y sello.
- `e2e/`: proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md §7.2 I`.**
   - Las variantes son un grupo de radio dentro del `<details>` del producto.
   - Los grupos de opciones son casillas con «Elige hasta 2» o «Elige al menos 1»; el `+` se habilita cuando la selección cumple el mínimo.
   - La cabecera lleva el teléfono y el horario de hoy.
   - Al pie, las zonas con tarifa y el sello.
2. **Lectura y caché (ADR-014).** Pedir `/version`. Si la Cache API de WEB tiene `menu:{slug}:v{menuVersion}`, servirla; si no, leer el menú completo y guardarlo. El TTL lo fija el pedido al backend n.º 3; hasta que se acepte, solo se usa `cache-control: public, max-age=60, s-maxage=300` (`AGENTS.md §6.4`).
3. **Mesa.** `?mesa=n` válido de 1 a `tableCount`.
4. **`<svelte:head>`.** Título, descripción y Open Graph con el nombre y la portada.

## Pedidos (regla de paridad)

La API todavía no recibe pedidos (backend T21). Por eso:

- **Menú real.** Se ve completo y permite armar el carrito. «Ver pedido» lleva a un aviso «Este menú todavía no recibe pedidos en línea», en lugar de al checkout simulado. Cuando llegue T21, solo cambia ese destino.
- **Negocio de ejemplo (`tacos-el-guero`).** Conserva su checkout simulado para la landing, marcado `// TEMPORAL: sin API todavía (T21)`. Requiere el pedido al backend n.º 2 para que ningún negocio real tome ese slug.

## Criterios de aceptación

- [ ] Cada fila de la tabla se ve en el menú público con datos de la API.
- [ ] Un producto con 3 variantes y un grupo «mínimo 1, máximo 2» obliga a elegir variante y de 1 a 2 opciones; el precio mostrado coincide con el de la API.
- [ ] Cada `notAcceptingReason` se ve como en `DESIGN.md §7.2`; un slug inexistente o en borrador, el `404` de siempre; una falla de la API, el estado de task-12.
- [ ] Editar el catálogo cambia el menú en la siguiente visita (versión nueva).
- [ ] `/m/*` no llama a `/v1/me` y sigue legible sin JavaScript y a 360px.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Checkout, seguimiento y panel de pedidos con la API: backend T21–T23.
- Avisos por WhatsApp: backend T24–T25.
