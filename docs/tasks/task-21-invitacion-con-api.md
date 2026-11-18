# Task 21 — `/invitacion` con la API

**Prioridad:** P1
**Categoría:** Integración con la API
**Depende de:** task-16, task-17

> No confundir con la task T21 del backend. Esta task consume T13 (invitaciones) y T09 (Turnstile).

## Contexto

task-13 construyó `/invitacion` (`DESIGN.md §7.1 H`) con la respuesta de la API simulada en `demo.ts`. Los estados difíciles se ven con `?estado=…` en development, y el widget de Turnstile es un comentario `TEMPORAL`. La API ya tiene:

| Método | Ruta                                    | Respuesta                                                                                                                |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/public/invitations/{token}`        | `InvitationPreviewDto { orgName, role, emailMasked, expired, accountExists }`; `404` si no existe, se aceptó o se revocó |
| POST   | `/v1/public/invitations/{token}/accept` | `AcceptInvitationDto { orgId }` con la cookie si no había sesión. Sin sesión: `{ name, password }` y Turnstile           |

Errores de aceptar:

- `400`: datos, contraseña filtrada o Turnstile;
- `401`: el correo ya tiene cuenta, entra con ella;
- `404`: no existe, ya se aceptó o se revocó;
- `409`: ya se usó, es para otro correo o ya eres miembro;
- `422`: venció o se canceló.

## Objetivo

Un enlace real de invitación muestra el negocio, el rol y el correo enmascarado. Aceptarlo crea la membresía y abre `/app` en esa organización.

## Archivos involucrados

- `apps/web/src/routes/(auth)/invitacion/+page.server.ts` y `+page.svelte`.
- `apps/web/src/lib/server/demo.ts`: se borran la invitación simulada y sus banderas `?estado=…`.
- `e2e/`: las pruebas de task-13 pasan al proyecto `integracion`; la fixture crea la invitación con la API local.

## Pasos sugeridos

1. **`load`.** Llama a `GET /v1/public/invitations/{token}`.
   - `404` → el estado «No válida» que ya existe;
   - `expired: true` → «Vencida»;
   - `accountExists: true` sin sesión → «Entra con tu cuenta para aceptar la invitación.» y «Entrar», con `siguiente` (ya existe).

   Se conservan `cache-control: no-store` y `referrer-policy: no-referrer`.

2. **Aceptar.**
   - Con sesión, la action llama a `POST …/accept` sin cuerpo.
   - Sin sesión, manda `{ name, password }`, validados con `AcceptInvitationInput`, y el token de Turnstile en el header.
   - En éxito, `redirect(303, '/app')`. La organización recién aceptada debe quedar activa (ver «Dudas»).
3. **Errores.** Cada código va al estado que ya diseñó task-13, con el mensaje de la API: los de campo bajo su control y los demás en el aviso. Con `400` de Turnstile, el widget se reinicia.
4. **Turnstile.** Reemplazar el comentario `TEMPORAL` por `Turnstile.svelte` (task-16), solo cuando no hay sesión.

## Dudas a resolver antes de empezar

- **Organización activa después de aceptar.** task-17 usa la primera membresía. Si quien acepta ya tenía otra organización, abriría la anterior. Recomendación: que `/app` acepte la organización elegida, guardada en una cookie `httpOnly` con el `orgId` de `AcceptInvitationDto`. Así el selector de varias organizaciones queda listo para después sin agregar UI.

## Criterios de aceptación

- [ ] Una invitación real creada por la fixture muestra organización, rol en español («dueño», «administrador», «personal») y correo enmascarado.
- [ ] Sin cuenta: nombre, contraseña y Turnstile crean la cuenta, aceptan y abren `/app` en esa organización.
- [ ] Con cuenta y sin sesión: «Entrar» y, después de entrar, de vuelta a la invitación para aceptarla.
- [ ] Vencida, revocada, ya usada o para otro correo → el estado de task-13 con el mensaje de la API.
- [ ] `demo.ts` ya no tiene la invitación simulada.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Invitar, cambiar rol y quitar miembros desde `/app/ajustes`: task-23.
