# Task 21 — Restablecer y cambiar la contraseña

**Prioridad:** P1
**Categoría:** Pantalla nueva · Paridad con la API
**Depende de:** task-16, task-17

> No confundir con la task T21 del backend. Consume T10 (reset y cambio de contraseña) y T09 (Turnstile y cuota de 3 por hora por correo). Matriz: `PARIDAD-API.md` § Identidad y sesión.

## Contexto

La API tiene tres flujos de contraseña y la UI no tiene ninguno. En `/entrar`, «¿Olvidaste tu contraseña?» está deshabilitado.

Los correos ya enlazan a `${WEB_ORIGIN}/restablecer`:

- `reset-password`, con `?token=…` (vence en 1 h);
- `password-changed` y `account-exists`, sin token.

| Método | Ruta                              | Contrato                                                                                                                                                                                                                      |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/auth/request-password-reset` | `RequestPasswordResetInput { email }` + `x-turnstile-token`. Siempre `202` con `LINK_SENT_MESSAGE`; `429` tras 3 por hora para ese correo                                                                                     |
| POST   | `/v1/auth/reset-password`         | `ResetPasswordInput { token, newPassword (10–128) }`. `200` y revoca todas las sesiones. Enlace malo: «El enlace no es válido o ya venció. Solicita otro.» Contraseña filtrada: «Esta contraseña se ha filtrado. Elige otra.» |
| POST   | `/v1/auth/change-password`        | `ChangePasswordInput { currentPassword, newPassword }`. WEB no envía `revokeOtherSessions`: la API lo fuerza. Encola el correo `password-changed`. Actual incorrecta: «La contraseña actual es incorrecta.»                   |

## Campos y validaciones

| Pantalla                 | Campo                                | Contrato                                      |
| ------------------------ | ------------------------------------ | --------------------------------------------- |
| `/restablecer` sin token | Correo; Turnstile                    | `RequestPasswordResetInput.email`             |
| `/restablecer?token=…`   | Contraseña nueva (mostrar u ocultar) | `newPassword` 10–128                          |
| `/app/ajustes` › Cuenta  | Contraseña actual; contraseña nueva  | `currentPassword` 1–128; `newPassword` 10–128 |

## Archivos involucrados

- `apps/web/DESIGN.md §7.1` (pantalla nueva `/restablecer`, sección «Cuenta» de F) y §6.
- `apps/web/src/routes/(auth)/restablecer/+page.server.ts` y `+page.svelte` (nuevas).
- `apps/web/src/routes/(auth)/entrar/+page.svelte`: «¿Olvidaste tu contraseña?» pasa a ser un enlace.
- `apps/web/src/routes/app/ajustes/`: «Cambiar contraseña» en la sección «Cuenta» de task-17.
- `e2e/`: proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md`.** `/restablecer` usa el contenedor de `/entrar`:
   - sin token: «Enviar enlace»;
   - con token: «Guardar contraseña», y después `/entrar` con «Tu contraseña cambió. Entra con la nueva.».

   En «Cuenta»: «Cambiar contraseña» y, al guardar, «Guardado».

2. **Pedir el enlace.**
   - `202` → mensaje en `aria-live`, idéntico exista o no la cuenta;
   - `429` → mensaje de la API;
   - Turnstile rechazado → error del widget, que se reinicia.
3. **Elegir la contraseña.** El token va en un campo oculto, no se registra, y la página lleva `no-store` y `no-referrer`.
4. **Cambiar con sesión.** La sesión actual sigue y las demás se cierran: la pantalla lo dice («Cerramos tus otras sesiones.»).

## Criterios de aceptación

- [ ] Con un correo con cuenta y con uno sin cuenta, la respuesta en pantalla es idéntica.
- [ ] El enlace real permite elegir la nueva; la vieja ya no entra y la nueva sí; las sesiones anteriores quedan cerradas.
- [ ] La cuarta solicitud en una hora muestra el mensaje de cuota.
- [ ] Cambiar con la actual incorrecta → mensaje de la API bajo «Contraseña actual». Con la correcta → guardado, y se encola `password-changed`.
- [ ] Una contraseña filtrada muestra el mensaje de la API en los dos flujos.
- [ ] `/entrar` → «¿Olvidaste tu contraseña?» → `/restablecer`, con teclado y a 360px.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Cambios en los correos o en `apps/api`.
