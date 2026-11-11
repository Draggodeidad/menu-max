# Task 12 — Mostrar un error de carga del menú público

**Prioridad:** P1
**Categoría:** Estados
**Depende de:** task-05

## Contexto

`getCategorias` de `apps/web/src/lib/server/demo.ts` permite simular vacío y lentitud, pero no un fallo de lectura. `apps/web/src/routes/m/[slug]/+page.server.ts` espera sus datos sin representar un error recuperable para el comensal. Las demás pantallas del panel sí tienen un estado de error.

## Objetivo

Poder simular en desarrollo una falla de carga del menú y mostrar al comensal un mensaje con una acción de reintento accesible.

## Archivos involucrados

- `apps/web/src/lib/server/demo.ts`
- `apps/web/src/routes/m/[slug]/+page.server.ts`
- `apps/web/src/routes/m/[slug]/+page.svelte`
- `apps/web/src/lib/components/MenuView.svelte`
- `e2e/estados.spec.ts`

## Pasos sugeridos

1. Agregar una bandera de error solo en desarrollo para la lectura del menú, sin impedir que el checkout conserve su propia simulación de producto agotado.
2. Propagar el error esperado desde el load y mostrar un mensaje en `role=alert` con un botón de reintento; al recuperar los datos, mostrar el menú.
3. Mantener las experiencias de carga, vacío y menú legible sin JavaScript.

## Criterios de aceptación

- [ ] Con `?error=1` el menú de desarrollo muestra una alerta y una acción «Reintentar», sin presentar un menú normal como si hubiera cargado.
- [ ] Se reactiva y pasa `e2e/estados.spec.ts › el menú público ofrece reintento ante un error de carga simulado`.
- [ ] Siguen pasando `e2e/estados.spec.ts › menú muestra vacío y negocio cerrado` y `e2e/estados.spec.ts › checkout informa producto agotado simulado`.

## Fuera de alcance

API real, observabilidad remota, reintentos automáticos y cambios visuales ajenos al estado de error.
