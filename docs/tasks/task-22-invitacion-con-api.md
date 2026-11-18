# Task 22 — `/invitacion` con la API

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-16, task-17, task-18

> No confundir con la task T22 del backend. Consume T13 (invitaciones) y T09 (Turnstile). Matriz: `PARIDAD-API.md` § Equipo, plan e invitaciones.

## Contexto

task-13 construyó `/invitacion` (`DESIGN.md §7.1 H`) con la API simulada: banderas `?estado=…` y un comentario `TEMPORAL` donde va Turnstile.

| Método | Ruta                                    | Contrato                                                                                                                                                                                        |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/public/invitations/{token}`        | Token de 43 caracteres base64url. `InvitationPreviewDto { orgName, role, emailMasked, expired, accountExists }`. `404`: no existe, se aceptó o se revocó                                        |
| POST   | `/v1/public/invitations/{token}/accept` | Con sesión: sin cuerpo. Sin sesión: `AcceptInvitationInput { name (1–120), password (10–128) }` + `x-turnstile-token`. `200` → `AcceptInvitationDto { orgId }` con la cookie si no había sesión |

Errores de aceptar:

- `400`: datos, contraseña filtrada o Turnstile;
- `401`: el correo ya tiene cuenta;
- `404`: no existe, se aceptó o se revocó;
- `409`: ya usada, para otro correo o ya eres miembro;
- `422`: venció o se canceló.

## Objetivo

Una invitación real se ve y se acepta. Al aceptarla, el panel abre en la organización recién aceptada.

## Archivos involucrados

- `apps/web/src/routes/(auth)/invitacion/+page.server.ts` y `+page.svelte`.
- `apps/web/src/lib/server/demo.ts`: se borran la invitación simulada y sus banderas.
- `e2e/`: task-13 pasa al proyecto `integracion`; la fixture invita con la API local.

## Pasos sugeridos

1. **`load`.** Un token con otro formato se trata como «No válida» sin llamar a la API.
   - `404` → «No válida»;
   - `expired` → «Vencida»;
   - `accountExists` sin sesión → «Entra con tu cuenta para aceptar la invitación.» con «Entrar» y `siguiente`.

   Se conservan `no-store` y `no-referrer`.

2. **Aceptar.** Validar con `AcceptInvitationInput` y usar `Turnstile.svelte` solo sin sesión. Cada código va al estado que ya diseñó task-13, con el mensaje de la API.
3. **Organización activa.** Al aceptar, se guarda `AcceptInvitationDto.orgId` como organización activa (cookie de task-18) y se abre `/app`.

## Criterios de aceptación

- [ ] La invitación de la fixture muestra organización, rol en español y correo enmascarado.
- [ ] Sin cuenta: nombre, contraseña (10–128) y Turnstile → cuenta creada y `/app` en esa organización, aunque la persona ya tenga otra.
- [ ] Con cuenta y sin sesión: «Entrar», y de vuelta a la invitación para aceptarla.
- [ ] Vencida, revocada, ya usada o para otro correo → su estado, con el mensaje de la API.
- [ ] `demo.ts` ya no tiene la invitación simulada.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Invitar y gestionar el equipo desde el panel: task-31.
