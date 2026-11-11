# Task 01 — Publicar un menú simulado

**Prioridad:** P0
**Categoría:** Funcionalidad
**Depende de:** ninguna

## Contexto

`apps/web/src/routes/crear/+page.svelte` guarda un borrador local, cancela el envío y deshabilita «Publicar menú». No existe `crear/+page.server.ts`; `/app/listo` usa siempre `slugNegocioDemo`. Los datos de ejemplo de creación también viven inline en el componente, pese a la convención de mocks de `apps/web/AGENTS.md`.

## Objetivo

Permitir crear y publicar un menú de demostración, validar sus campos y llegar a una activación cuyo QR abra el negocio y productos capturados en el mismo navegador.

## Archivos involucrados

- `apps/web/src/routes/crear/+page.svelte`
- `apps/web/src/routes/crear/+page.server.ts` (nuevo)
- `apps/web/src/routes/app/listo/+page.server.ts`
- `apps/web/src/lib/server/demo.ts`
- `apps/web/src/lib/components/MenuView.svelte`
- `apps/web/src/routes/m/[slug]/+layout.server.ts`
- `apps/web/src/routes/m/[slug]/+page.server.ts`
- `e2e/flujos.spec.ts`

## Pasos sugeridos

1. Modelar en el mock de servidor un negocio publicado, con productos en centavos, modalidades y datos mínimos; usar almacenamiento demo acotado por navegador, sin estado mutable global SSR.
2. Enviar el formulario mediante una form action, validar negocio, productos y precios, modalidades, WhatsApp y cuenta simulada, y devolver errores asociados a cada campo.
3. Tras el éxito, redirigir a `/app/listo` y generar el enlace/QR a partir del negocio publicado; preservar el borrador ante un error y alinear la vista previa con `MenuView`, conforme a `DESIGN.md`.
4. Mover datos iniciales relevantes al mock del servidor y dejar documentada su naturaleza temporal; no crear autenticación o base de datos reales.

## Criterios de aceptación

- [ ] La publicación demo abre un menú con el nombre y los productos capturados; un formulario inválido muestra mensajes asociados y conserva valores.
- [ ] La action funciona sin JavaScript y `use:enhance` mejora la experiencia; no se envían precios como autoridad para operaciones posteriores.
- [ ] Se reactivan y pasan `e2e/flujos.spec.ts › crear permite publicar el menú y abrirlo desde el QR` y `e2e/flujos.spec.ts › crear valida campos obligatorios antes de publicar`.
- [ ] Pasan los recorridos de borrador y navegación existentes en ambos viewports.

## Fuera de alcance

API, base de datos, registro real, envío real de mensajes, despliegue y cambios a otras pantallas más allá de consumir el negocio demo.
