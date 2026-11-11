# Task 07 — Aplicar el tema guardado al menú público

**Prioridad:** P1
**Categoría:** UI
**Depende de:** task-05

## Contexto

`apps/web/src/routes/app/ajustes/SeccionTema.svelte` muestra una vista previa y guarda el tema mediante su action. Sin embargo, `apps/web/src/routes/m/[slug]/+layout.server.ts` importa el objeto fijo `tema` de `demo.ts`; guardar `#123456` deja el menú público en `#1c1f1a`.

## Objetivo

Hacer que el tema guardado en la demostración se refleje en el menú público y mantenga el contraste exigido por `DESIGN.md`.

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/+page.server.ts`
- `apps/web/src/routes/app/ajustes/SeccionTema.svelte`
- `apps/web/src/routes/m/[slug]/+layout.server.ts`
- `apps/web/src/routes/m/[slug]/+layout.svelte`
- `apps/web/src/lib/server/demo.ts`
- `e2e/flujos.spec.ts`
- `e2e/formularios.spec.ts`

## Pasos sugeridos

1. Resolver preset, color y fuente desde el mock compartido por negocio y exponerlos por `load`.
2. Aplicar las variables `--brand*` y la fuente a la vista pública; mantener la vista previa alineada.
3. Conservar la validación de contraste y el valor guardado tras recargar el mismo navegador.

## Criterios de aceptación

- [ ] Guardar un tema válido cambia la apariencia del menú público de esa demostración; un tema de contraste insuficiente se rechaza.
- [ ] Se reactiva y pasa `e2e/flujos.spec.ts › el tema guardado se aplica al menú público`.
- [ ] Sigue pasando `e2e/formularios.spec.ts › ajustes valida contraste insuficiente del color`.

## Fuera de alcance

Nuevos presets, rediseño visual del producto, contratación de fuentes y configuración del backend.
