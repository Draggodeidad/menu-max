# Task 23 — `/app/ajustes` con la API

**Prioridad:** P1
**Categoría:** Integración con la API
**Depende de:** task-17, task-18

> No confundir con la task T23 del backend. Esta task consume T14 (planes y suscripción), T15 (negocio, sucursales, horarios, modalidades, mesas y zonas, ADR-018), T13 (miembros e invitaciones), T18 (tema) y T19 (QR).

## Contexto

`/app/ajustes` (`DESIGN.md §7.1 F`) guarda todo en una cookie (`COOKIE_AJUSTES`). Tiene las secciones Tema, Servicio, Zonas, Equipo y QR, las actions `tema`, `servicio`, `zonas`, `invitar`, `rol`, `quitar` y `mesas`, y la línea del fin de la prueba de task-14.

La API ya tiene, todo bajo `/v1/orgs/{orgId}`:

| Sección  | Rutas                                                                                                                                                   | Notas                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tema     | `GET`, `PUT /branches/{branchId}/menu/theme`                                                                                                            | `UpdateThemeInput` con `version`. En `free`, solo `preset` y `primaryColor`; lo demás → `402 PLAN_LIMIT_REACHED` |
| Servicio | `PATCH /branches/{branchId}` (`modes`, `tableCount`, `alertWhatsapp`, `contactPhone`, con `version`); `PUT /branches/{branchId}/hours` (rangos por día) | Horarios en hora local de la sucursal                                                                            |
| Zonas    | `GET`, `POST /branches/{branchId}/zones`; `PATCH`, `DELETE /zones/{zoneId}`                                                                             | Una zona = nombre, **códigos postales** y tarifa en centavos (ADR-018)                                           |
| Equipo   | `GET /members`, `PATCH /members/{id}` (rol), `DELETE /members/{id}`; `GET`, `POST /invitations`, `DELETE /invitations/{id}`                             | Invitar exige correo verificado (`403 EMAIL_NOT_VERIFIED`); `admin` solo gestiona `staff`                        |
| QR       | `GET /branches/{branchId}/qr` y `?mesa=n`                                                                                                               | SVG para `{@html}`; solo con el menú publicado                                                                   |
| Plan     | `GET /subscription`                                                                                                                                     | Solo `owner` (`subscription:read`)                                                                               |

## Objetivo

Cada sección guarda en la API y el menú público refleja los cambios. Lo que el plan o el rol no permite se explica con el mensaje de la API.

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/+page.server.ts`, `+page.svelte` y `Seccion*.svelte`.
- `apps/web/src/lib/server/demo.ts`: se borran los ajustes simulados.
- `apps/web/DESIGN.md §7.1 F`, si cambian los campos de zonas o de horarios (ver «Dudas»).
- `e2e/`: las pruebas de ajustes pasan al proyecto `integracion`.

## Pasos sugeridos

1. **`load`.** Lee en paralelo:
   - sucursal (`GET /branches/{branchId}`, con horarios);
   - tema, zonas, miembros e invitaciones;
   - la suscripción, solo para `owner`.

   Cada formulario lleva la `version` de lo que edita en un campo oculto.

2. **Una sección a la vez.** Conectar y probar en commits separados, en este orden: Servicio y mesas → Tema → Zonas → Equipo → QR → línea del plan.
3. **Errores.**
   - `409 CONFLICT` → aviso en la sección con los datos recién leídos;
   - `402` → el mensaje de la API junto al control bloqueado (tema en `free`);
   - `403 EMAIL_NOT_VERIFIED` al invitar → el mensaje de la API y el enlace al reenvío de task-19;
   - `400` con `fieldErrors` → bajo cada campo.
4. **Tema.** Los controles que el plan no permite se muestran deshabilitados con su motivo, leído de `subscription`. Así el `402` no es la primera noticia. La vista previa sigue siendo local.
5. **QR.** La sección usa el SVG de la API, el del menú y uno por mesa con `?mesa=n`, igual que `/app/listo` (task-18).
6. **Plan.** La línea de task-14 («Tu prueba gratis termina el …») sale de `SubscriptionDto` (`status: "trialing"`, `currentPeriodEnd`) y solo la ve `owner`.

## Dudas a resolver antes de empezar

- **Zonas sin códigos postales.** La pantalla pide nombre («Colonias de la zona») y costo. La API exige además la lista de códigos postales de 5 dígitos (ADR-018, hasta 100 por zona, sin repetir entre zonas activas). Recomendación: agregar a cada zona un campo «Códigos postales» (separados por coma) en `DESIGN.md §7.1 F` y en la pantalla. El conflicto de código repetido se muestra con su `fieldErrors`.
- **Horarios.** La pantalla tiene una sola hora de apertura y cierre. La API guarda rangos por día. Opciones:
  - (a) aplicar el mismo rango a los 7 días;
  - (b) agregar días a la pantalla (cambia `DESIGN.md`).

  Recomendación: (a) para el piloto. Al leer, si los días no coinciden, se avisa «Tus horarios cambian por día; se editan pronto» en lugar de sobrescribirlos.

- **Publicar, despublicar y cambiar el slug.** La API los tiene (`/menu/publish`, `/menu/unpublish`, `/menu/slug`), pero `DESIGN.md` no los ubica. Recomendación: dejarlos fuera de esta task.

## Criterios de aceptación

- [ ] Cada sección guarda en la API y persiste al recargar; el menú público refleja modalidades, horario, zonas y tema.
- [ ] En `free`, los controles de tema que no incluye el plan están deshabilitados con su motivo; forzar el envío muestra el `402` de la API.
- [ ] Invitar con el correo sin verificar muestra `EMAIL_NOT_VERIFIED`; verificado, la invitación aparece en la lista y su correo se imprime en local.
- [ ] Un `admin` no puede cambiar ni quitar a un `owner`: la UI no lo ofrece y la API lo rechaza.
- [ ] El QR de la sección es el de la API, para el menú y para cada mesa.
- [ ] Solo `owner` ve la línea del fin de la prueba, con la fecha de `currentPeriodEnd`.
- [ ] `demo.ts` ya no tiene los ajustes simulados.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Varias sucursales y su selector.
- Las alertas por WhatsApp y su opt-in: dependen del backend T24.
- Cobro y cambio de plan: Release 2 (pagos en línea fuera del MVP).
