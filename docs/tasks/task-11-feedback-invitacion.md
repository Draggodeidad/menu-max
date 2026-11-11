# Task 11 — Aclarar que la invitación es simulada

**Prioridad:** P1
**Categoría:** Estados
**Depende de:** ninguna

## Contexto

La action `invitar` de `apps/web/src/routes/app/ajustes/+page.server.ts` solo agrega un miembro pendiente a la cookie demo, pero devuelve «Invitación enviada a …». `apps/web/src/routes/app/ajustes/SeccionEquipo.svelte` presenta ese texto como éxito, aunque no existe servicio de correo.

## Objetivo

Dar feedback honesto y accesible de que la invitación se simuló, conservando la demostración del equipo y sin enviar correo real.

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/+page.server.ts`
- `apps/web/src/routes/app/ajustes/SeccionEquipo.svelte`
- `apps/web/src/lib/server/demo.ts`
- `e2e/flujos.spec.ts`

## Pasos sugeridos

1. Ajustar el resultado y el texto de la sección para diferenciar una invitación simulada de un envío real.
2. Mantener la validación de correo, la indicación de miembro pendiente y el anuncio mediante `role=status`.
3. Evitar depender de un prefijo textual frágil para decidir qué confirmación mostrar.

## Criterios de aceptación

- [ ] La persona ve que la invitación es una demostración y no se le promete un correo enviado.
- [ ] Se reactiva y pasa `e2e/flujos.spec.ts › la invitación deja claro que el envío es simulado` en ambas resoluciones.

## Fuera de alcance

Enviar correos, invitaciones reales, roles reales o cambios en la API.
