# Task 24 — Menú público (`/m/[slug]`) con la API

**Prioridad:** P1
**Categoría:** Integración con la API
**Depende de:** task-16, task-22, task-23

> No confundir con la task T24 del backend. Esta task consume T18 (lectura pública y `menuVersion`) y ADR-014 (caché del menú en WEB con versión).

## Contexto

`/m/[slug]` (`DESIGN.md §7.2 I`) arma hoy el menú desde `demo.ts`:

- el negocio de ejemplo `tacos-el-guero`;
- el menú publicado en la cookie de `/crear`;
- los ajustes de la cookie de `/app/ajustes`.

La API ya tiene:

| Método | Ruta                              | Respuesta                                                                                                                                                          |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/public/menus/{slug}`         | `PublicMenuDto`: negocio, sucursal (horario de hoy, `isOpen`, modalidades, zonas sin códigos postales), tema, categorías, `acceptingOrders` y `notAcceptingReason` |
| GET    | `/v1/public/menus/{slug}/version` | `PublicMenuVersionDto { menuVersion }`: lectura mínima para la llave de caché                                                                                      |

`DESIGN.md §7.2` ya describe los estados `closed`, `unverified`, `suspended` e `inactive`. ADR-014 pone la caché en WEB con la llave `menu:{slug}:v{menuVersion}`: publicar o editar sube la versión, así que no hace falta purgar. Su TTL (300 s) sigue `Propuesto`.

Los pedidos todavía no existen en la API (backend T21–T23). El checkout (`/m/[slug]/pedido`) y el seguimiento (`/pedido/[token]`) siguen en `demo.ts`.

## Objetivo

El QR impreso abre el menú real del negocio, con su tema, su horario y el estado que dicta la API. El menú se lee rápido sin dejar de reflejar las ediciones.

## Archivos involucrados

- `apps/web/src/routes/m/[slug]/+layout.server.ts` y `+page.server.ts`.
- `apps/web/src/lib/components/MenuView.svelte`, solo si el mapeo desde `PublicMenuDto` lo exige.
- `apps/web/src/lib/server/demo.ts`: se borran `publicadoPara`, `COOKIE_PUBLICADO`, `COOKIE_AJUSTES` y lo que solo usaba el menú simulado.
- `e2e/`: las pruebas del menú público pasan al proyecto `integracion`.

## Pasos sugeridos

1. **Lectura.** `+layout.server.ts` llama a `GET /v1/public/menus/{slug}` con `api()`.
   - `404` → el error que ya existe («Este menú no existe o ya no está publicado.»);
   - otro error → el estado de task-12.

   Mapear `PublicMenuDto` a lo que consume `MenuView`: dinero en centavos, `imageUrl` de la API, `theme` → variables `--brand*` (`DESIGN.md §3.2` y §3.6).

2. **Estados.** `acceptingOrders` y `notAcceptingReason` deciden los botones `+` y la cabecera, como en `DESIGN.md §7.2`. `inactive` no trae categorías.
3. **Caché (ADR-014).** Guardar la respuesta con la Cache API de WEB con la llave `menu:{slug}:v{menuVersion}`.
   - En cada visita se pide primero `/version`, que es barata.
   - Si la llave existe, se sirve; si no, se lee el menú completo y se guarda.

   Encabezados: `cache-control: public, max-age=60, s-maxage=300` (`AGENTS.md §6.4`). Nunca se cachea nada con sesión ni el checkout.

4. **Mesa.** `?mesa=n` se valida contra `branch.tableCount`, como hoy contra el mock.
5. **`<svelte:head>`.** Título, descripción y Open Graph con el nombre del negocio y la portada (`theme.coverUrl`), si existe.

## Dudas a resolver antes de empezar

- **TTL de la caché.** ADR-014 deja el TTL `Propuesto` (300 s). Recomendación: usar 300 s y pedir que se acepte el ADR, o esperar su aprobación antes de activar la caché.
- **Pedir en un menú real antes de T21.** Un menú verificado responde `acceptingOrders: true`, pero aún no hay a dónde enviar el pedido. Opciones:
  - (a) mientras no exista T21, tratar los menús reales como `unverified` en WEB («Este menú todavía no recibe pedidos»);
  - (b) dejar el checkout simulado también para menús reales.

  Recomendación: (a). No se simulan pedidos de un negocio real, y el texto ya existe en `DESIGN.md`.

- **El negocio de ejemplo.** La landing enlaza a `tacos-el-guero` como menú demo navegable con pedido simulado. Ese slug no está en `RESERVED_SLUGS` (`packages/contracts/src/storefront.ts`), así que un negocio real llamado «Tacos El Güero» puede quedárselo. Recomendación:
  - conservar el ejemplo en `demo.ts` como única excepción hasta T21, marcado `// TEMPORAL`;
  - pedir un cambio de contrato, en su propio PR del backend, que agregue el slug del ejemplo a `RESERVED_SLUGS`. Esta task no toca `packages/contracts`.

## Criterios de aceptación

- [ ] El `menuUrl` de un alta real (task-18) abre su menú con los productos, el tema y el horario de la API.
- [ ] Cada estado de `notAcceptingReason` se ve como describe `DESIGN.md §7.2`.
- [ ] Editar un producto en `/app/catalogo` cambia el menú público en la siguiente visita: la versión nueva invalida la caché.
- [ ] Un slug inexistente muestra el `404` de siempre; una falla de la API, el estado de task-12.
- [ ] `?mesa=n` fuera de rango se rechaza como hoy.
- [ ] El menú sigue legible sin JavaScript y a 360px.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Checkout, seguimiento y panel de pedidos con la API: dependen del backend T21–T23.
- Aviso por WhatsApp: backend T24–T25.
