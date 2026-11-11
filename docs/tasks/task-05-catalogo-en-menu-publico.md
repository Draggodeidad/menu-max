# Task 05 — Reflejar el catálogo editado en el menú público

**Prioridad:** P1
**Categoría:** Arquitectura
**Depende de:** task-01

## Contexto

`apps/web/src/routes/app/catalogo/+page.server.ts` guarda cambios en `demo_catalogo` con `path: /app`. El menú público carga `getCategorias` desde `apps/web/src/lib/server/demo.ts`, separado de `CATALOGO_BASE` y de esa cookie. Cambiar pastor a $32.00 muestra «Guardado», pero el menú público sigue en $22.00; incluso hay productos con disponibilidad distinta. El panel dice «Taquería El Nopal» y la vista pública fija muestra «Tacos El Güero».

## Objetivo

Unificar la lectura demo de negocio, productos, precios, disponibilidad y opciones para que el panel y el menú público del mismo navegador muestren datos coherentes.

## Archivos involucrados

- `apps/web/src/lib/server/demo.ts`
- `apps/web/src/routes/app/catalogo/+page.server.ts`
- `apps/web/src/routes/m/[slug]/+layout.server.ts`
- `apps/web/src/routes/m/[slug]/+page.server.ts`
- `apps/web/src/lib/components/MenuView.svelte`
- `e2e/flujos.spec.ts`

## Pasos sugeridos

1. Modelar un contrato temporal tipado y funciones de lectura/mutación del catálogo en el mock de servidor, reutilizando las operaciones y límites ya existentes.
2. Consumir el mismo negocio y catálogo desde los loads del panel y del menú público, conservando la separación servidor/componentes y datos en centavos.
3. Aplicar edición, altas, bajas, disponibilidad y variantes al menú de demo del mismo navegador, y alinear el nombre/slug con la activación.
4. Evitar afirmar sincronización entre navegadores: sin backend esa capacidad sigue pendiente.

## Criterios de aceptación

- [ ] El precio editado aparece en el menú del negocio tras recargar; los productos agotados no se ofrecen como disponibles.
- [ ] Los componentes no importan datos mock de ejecución; los loads y actions consumen el contrato temporal del servidor.
- [ ] Se reactiva y pasa `e2e/flujos.spec.ts › el precio editado en el catálogo se refleja en el menú público`.
- [ ] Sigue pasando `e2e/formularios.spec.ts › catálogo valida y agrega un producto en una categoría`.

## Fuera de alcance

API real, almacenamiento compartido entre usuarios, rediseño completo del catálogo y migración de contratos a un paquete inexistente.
