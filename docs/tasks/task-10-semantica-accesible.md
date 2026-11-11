# Task 10 — Corregir semántica accesible del catálogo y checkout

**Prioridad:** P1
**Categoría:** A11y
**Depende de:** ninguna

## Contexto

Axe detecta `definition-list` y `dlitem` con impacto serio en el resumen de `apps/web/src/routes/app/catalogo/+page.svelte`: los elementos `dt` y `dd` están dentro de un `div` adicional. En `apps/web/src/routes/m/[slug]/pedido/+page.svelte` la página carece de landmark `main`, lo que dificulta saltar al contenido principal.

## Objetivo

Hacer válidas las relaciones semánticas del resumen del catálogo y exponer el contenido principal del checkout a tecnologías de asistencia, sin alterar el diseño.

## Archivos involucrados

- `apps/web/src/routes/app/catalogo/+page.svelte`
- `apps/web/src/routes/m/[slug]/pedido/+page.svelte`
- `e2e/accesibilidad.spec.ts`

## Pasos sugeridos

1. Reestructurar la lista de definiciones para que sus grupos cumplan la semántica HTML y conserven orden y presentación.
2. Añadir un único landmark principal apropiado al contenido del checkout, incluidos sus estados de carga y vacío cuando corresponda.
3. Verificar con teclado y con Axe en ambos tamaños. La auditoría automática no sustituye una revisión manual de lector de pantalla.

## Criterios de aceptación

- [ ] Axe ya no reporta `definition-list` ni `dlitem` en el catálogo y el checkout expone exactamente un `main`.
- [ ] Se reactiva la condición `fixme` y pasa `e2e/accesibilidad.spec.ts › accesibilidad automática: catálogo`.
- [ ] Se reactiva y pasa `e2e/accesibilidad.spec.ts › checkout tiene un landmark principal`; sigue pasando `e2e/accesibilidad.spec.ts › accesibilidad automática: checkout con productos`.

## Fuera de alcance

Rediseño de pantallas, nuevas dependencias de UI y cambios de reglas de negocio.
