# Task 32 — Plan, uso y suscripción suspendida

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-18

> No confundir con la task T32 del backend (no existe). Consume T14, T14b, T20 (prueba de 90 días) y T20b (paso a `free`). Matriz: `PARIDAD-API.md` § Equipo, plan e invitaciones.

## Contexto

`/app/ajustes` solo muestra «Tu prueba gratis termina el …» (task-14). La API expone la suscripción completa en `GET /v1/orgs/{orgId}/subscription` (solo `owner`, `subscription:read`):

- `plan { id, name }`;
- `status`: `trialing`, `active`, `past_due` o `suspended`;
- `currentPeriodEnd`;
- `limits { maxBranches, maxProducts, maxMembers }`;
- `usage { branches, products, members }`;
- `features { customTheme, removeBranding }`.

Con la suscripción `suspended`, toda escritura responde `403` con `SUSPENDED_MESSAGE`: «Tu suscripción está suspendida: puedes consultar tu información, pero no hacer cambios.»

## Campos y validaciones

| Control                                                                              | Contrato                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Nombre del plan y estado («Prueba gratis», «Activo», «Pago pendiente», «Suspendido») | `plan.name`, `status`                                                            |
| «Tu prueba gratis termina el {fecha}» (solo `trialing`)                              | `currentPeriodEnd`, con `Intl.DateTimeFormat("es-MX")` en la zona de la sucursal |
| Uso contra límite: «Sucursales 1 de 1 · Productos 12 de 50 · Equipo 2 de 3»          | `usage` y `limits`                                                               |
| Capacidades: «Tema personalizado», «Quitar “Hecho con MenusMax”» (incluido o no)     | `features`                                                                       |
| Modo solo lectura                                                                    | `status: suspended`                                                              |

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/+page.server.ts` y `+page.svelte`: sección «Plan».
- `apps/web/src/routes/app/+layout.server.ts` y `+layout.svelte`: modo solo lectura en todo el panel.
- `apps/web/DESIGN.md §7.1 F` y §6.
- `e2e/`: proyecto `integracion`, con suscripciones en cada estado.

## Pasos sugeridos

1. **`DESIGN.md`.** Sección «Plan» al final de ajustes: estado, fecha, uso con barras sencillas (tokens, sin `cempasuchil`) y capacidades. Solo la ve `owner`.
2. **Uso compartido.** Las tasks 23, 26 y 31 muestran «12 de 50» junto a su `402`, con el mismo dato.
3. **Suspendida.** Si un `403` trae `SUSPENDED_MESSAGE`, o `status` es `suspended` para `owner`:
   - aviso persistente en el panel con el mensaje de la API;
   - formularios deshabilitados.

   Para `admin` y `staff`, que no leen la suscripción, el primer `403` activa el mismo modo hasta recargar.

## Criterios de aceptación

- [ ] `owner` ve plan, estado, fecha (solo en prueba), uso y capacidades, leídos de la API.
- [ ] `admin` y `staff` no ven la sección.
- [ ] Con `suspended`, el panel queda en solo lectura con el mensaje de la API, y ningún formulario envía.
- [ ] Cambiar un límite en `plans` (API local) cambia lo que muestra la sección, sin tocar WEB.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Cobro, cambio de plan y página de precios: Release 2 (pagos en línea fuera del MVP).
