# Task 06 — Aplicar modalidades y horarios guardados

**Prioridad:** P1
**Categoría:** Funcionalidad
**Depende de:** task-05

## Contexto

`apps/web/src/routes/app/ajustes/+page.server.ts` guarda las modalidades en una cookie limitada a `/app`. `apps/web/src/routes/m/[slug]/pedido/+page.svelte` presenta siempre recoger y domicilio y el mock público usa horario fijo. Al desactivar domicilio y guardar, sigue siendo seleccionable.

## Objetivo

Hacer que las modalidades y horarios guardados gobiernen el menú y checkout de demostración del mismo navegador.

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/+page.server.ts`
- `apps/web/src/lib/server/demo.ts`
- `apps/web/src/routes/m/[slug]/+layout.server.ts`
- `apps/web/src/routes/m/[slug]/pedido/+page.server.ts`
- `apps/web/src/routes/m/[slug]/pedido/+page.svelte`
- `e2e/flujos.spec.ts`
- `e2e/estados.spec.ts`

## Pasos sugeridos

1. Consultar los ajustes simulados mediante la capa compartida de task-05, sin leer cookies directamente en componentes.
2. Mostrar y validar en servidor solo las modalidades habilitadas; conservar la modalidad mesa cuando corresponda y explicar el cierre.
3. Comprobar las reglas de horarios y las banderas de desarrollo existentes con datos consistentes.

## Criterios de aceptación

- [ ] Domicilio deshabilitado no se ofrece ni se acepta por envío manipulado; los horarios y cierre usan los ajustes demo.
- [ ] Se reactiva y pasa `e2e/flujos.spec.ts › las modalidades guardadas se respetan en el checkout`.
- [ ] Siguen pasando `e2e/flujos.spec.ts › un pedido de mesa conserva el número y no pide modalidad` y `e2e/estados.spec.ts › menú muestra vacío y negocio cerrado`.

## Fuera de alcance

Logística real, cálculo geográfico de cobertura, envío de mensajes y backend.
