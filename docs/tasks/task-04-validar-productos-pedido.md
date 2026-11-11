# Task 04 — Validar los productos del pedido en servidor

**Prioridad:** P1
**Categoría:** Funcionalidad
**Depende de:** task-02

## Contexto

La action `enviar` de `apps/web/src/routes/m/[slug]/pedido/+page.server.ts` comprueba que existan strings y cantidades en rango, pero no que los IDs o variantes pertenezcan al menú ni que estén disponibles. Un campo oculto alterado a `producto-inexistente` obtiene redirección de éxito.

## Objetivo

Rechazar de forma comprensible pedidos con productos o variantes inexistentes o no disponibles antes de crear el pedido simulado.

## Archivos involucrados

- `apps/web/src/routes/m/[slug]/pedido/+page.server.ts`
- `apps/web/src/routes/m/[slug]/pedido/+page.svelte`
- `apps/web/src/lib/server/demo.ts`
- `e2e/flujos.spec.ts`
- `e2e/estados.spec.ts`

## Pasos sugeridos

1. Resolver cada id y variante contra el catálogo demo correspondiente al negocio; comprobar disponibilidad y cantidades y recalcular montos desde datos del servidor.
2. Devolver un error accionable con `fail`, conservar los datos del formulario y evitar crear o redirigir un pedido inválido.
3. Mantener las banderas demo de producto agotado y de negocio cerrado.

## Criterios de aceptación

- [ ] El servidor rechaza un id alterado y no crea un pedido ni muestra seguimiento de éxito.
- [ ] Se reactiva y pasa `e2e/flujos.spec.ts › checkout rechaza un producto inexistente`.
- [ ] Sigue pasando `e2e/estados.spec.ts › checkout informa producto agotado simulado`.

## Fuera de alcance

Catálogo real, reservas de inventario, pagos y endurecimiento de una API que aún no existe.
