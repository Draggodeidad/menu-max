# Task 20 — Restablecer la contraseña

**Prioridad:** P1
**Categoría:** Pantalla nueva · Integración con la API
**Depende de:** task-16, task-17

> No confundir con la task T20 del backend. Esta task consume T10 (reset de contraseña) y T09 (Turnstile y cuota de 3 por hora por correo).

## Contexto

En `/entrar`, «¿Olvidaste tu contraseña?» es un botón deshabilitado: «La recuperación de contraseña aún no está disponible.» Los correos de la API ya enlazan a `${WEB_ORIGIN}/restablecer`:

- `reset-password`: `/restablecer?token=…`, vence en 1 hora;
- `password-changed` y `account-exists` (T20c): `/restablecer` sin token, para pedir un enlace.

Esa pantalla no existe en WEB ni en `DESIGN.md §7` (task-15 la dejó pendiente). La API ya tiene:

| Método | Ruta                              | Respuesta                                                                                                                                                |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/auth/request-password-reset` | Con `x-turnstile-token`. Siempre `202`: «Si el correo existe, te enviamos un enlace.» `429` tras 3 por hora para ese correo                              |
| POST   | `/v1/auth/reset-password`         | `{ token, newPassword }` (10 a 128). `200` y revoca todas las sesiones. Enlace vencido o no válido: «El enlace no es válido o ya venció. Solicita otro.» |

## Objetivo

Quien olvidó su contraseña pide un enlace, elige una nueva y entra con ella. La pantalla nunca revela si el correo tiene cuenta.

## Archivos involucrados

- `apps/web/DESIGN.md`: pantalla nueva en §7.1 (`/restablecer`) y sus textos en §6.
- `apps/web/src/routes/(auth)/restablecer/+page.server.ts` y `+page.svelte` (nuevas).
- `apps/web/src/routes/(auth)/entrar/+page.svelte`: «¿Olvidaste tu contraseña?» pasa a ser un enlace a `/restablecer`.
- `e2e/`: pruebas del proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md` primero.** Agregar `/restablecer` a §7.1 con sus dos estados. Usa el contenedor de `/entrar`, como `/invitacion`.
   - **Sin token:** «Correo», Turnstile y «Enviar enlace». Al enviar, siempre el mismo mensaje de la API, exista o no la cuenta.
   - **Con token:** «Contraseña nueva» (de 10 a 128 caracteres, con mostrar u ocultar como en `/entrar`) y «Guardar contraseña». Al guardar, `/entrar` con «Tu contraseña cambió. Entra con la nueva.»
2. **Pedir el enlace.** Action `pedir`:
   - valida con `RequestPasswordResetInput`;
   - reenvía el token de Turnstile en el header;
   - `202` → el mensaje en `aria-live`, con el correo conservado;
   - `429` → el mensaje de la API;
   - `400` de Turnstile → el error del widget, que se reinicia.
3. **Elegir la contraseña.** Action `guardar`:
   - el token viaja en un `<input type="hidden">` tomado de la URL en `load`;
   - valida con `ResetPasswordInput`;
   - en éxito, `redirect(303, '/entrar?…')` con el aviso, sin el token.

   El token no se registra, y la página lleva `cache-control: no-store` y `referrer-policy: no-referrer`.

4. **`/entrar`.** El botón deshabilitado se vuelve un enlace a `/restablecer` y se quita el texto «aún no está disponible».

## Dudas a resolver antes de empezar

- **Textos nuevos.** «Enviar enlace», «Guardar contraseña» y «Tu contraseña cambió. Entra con la nueva.» son propuestas: `DESIGN.md` no los define. Se confirman al escribir §6.

## Criterios de aceptación

- [ ] `DESIGN.md §6` y §7.1 describen la pantalla.
- [ ] Con un correo con cuenta y con uno sin cuenta, la respuesta en pantalla es idéntica.
- [ ] El enlace real del correo permite elegir una contraseña nueva; después, la vieja ya no entra y la nueva sí.
- [ ] Un enlace vencido o alterado muestra el mensaje de la API y la forma de pedir otro.
- [ ] La cuarta solicitud en una hora muestra el mensaje de cuota de la API.
- [ ] «¿Olvidaste tu contraseña?» en `/entrar` lleva a `/restablecer`, con teclado y a 360px.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Cambiar la contraseña con sesión (`POST /v1/auth/change-password`): no está en `DESIGN.md`.
- Cambios en los correos o en `apps/api`.
