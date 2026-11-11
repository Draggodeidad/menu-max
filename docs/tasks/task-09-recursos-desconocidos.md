# Task 09 — Rechazar negocios y pedidos desconocidos

**Prioridad:** P1
**Categoría:** Mocks
**Depende de:** task-01, task-02

## Contexto

`getNegocio(slug, url)` en `apps/web/src/lib/server/demo.ts` devuelve el mismo negocio para cualquier slug y `getPedido(token, url)` fabrica un pedido para cualquier token. Los loads de `/m/[slug]` y `/pedido/[token]` responden 200 incluso si el recurso nunca existió.

## Objetivo

Hacer que los identificadores de negocio y pedido se resuelvan contra el estado demo y que los inexistentes produzcan una respuesta 404 comprensible.

## Archivos involucrados

- `apps/web/src/lib/server/demo.ts`
- `apps/web/src/routes/m/[slug]/+layout.server.ts`
- `apps/web/src/routes/pedido/[token]/+page.server.ts`
- `e2e/navegacion.spec.ts`
- `e2e/helpers.ts`

## Pasos sugeridos

1. Consultar los negocios publicados y pedidos creados mediante los contratos temporales de las tareas previas.
2. Lanzar `error(404, ...)` para ids desconocidos y preservar ejemplos explícitamente sembrados para la demo.
3. Adaptar el fixture de rutas para que los slugs y tokens válidos se creen o se siembren, sin aceptar cualquier valor.

## Criterios de aceptación

- [ ] Un negocio y un token desconocidos responden 404; los recursos publicados o creados responden 200.
- [ ] Se reactivan y pasan `e2e/navegacion.spec.ts › un negocio desconocido responde 404` y `e2e/navegacion.spec.ts › un token de pedido desconocido responde 404`.
- [ ] Las pruebas de navegación a recursos demo válidos siguen pasando en ambas resoluciones.

## Fuera de alcance

Páginas nuevas fuera del flujo de diseño, base de datos, indexación de buscadores y backend.
