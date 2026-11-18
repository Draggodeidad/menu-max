# Task 20 — Verificar el correo y reenviar el enlace

**Prioridad:** P0
**Categoría:** Pantalla nueva · Paridad con la API
**Depende de:** task-17, task-19

> No confundir con la task T20 del backend. Consume T10 (verificación y reenvío) y ADR-008. Matriz: `PARIDAD-API.md` § Identidad y sesión.

## Contexto

El correo de alta enlaza a `${WEB_ORIGIN}/verificar-correo?token=…`, pantalla que no existe. La API tiene:

| Método | Ruta                               | Respuesta                                                                                                                                                                                             |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/auth/verify-email?token=…`    | `200` con la cookie de sesión y sube `menuVersion` de sus menús. `400`: «El enlace no es válido o ya venció. Solicita otro.» `409`: «Este enlace ya se usó. Si ya confirmaste tu correo, solo entra.» |
| POST   | `/v1/auth/send-verification-email` | Con sesión. `202`: `LINK_SENT_MESSAGE`. `429`: «Ya te enviamos un enlace…» (1 cada 60 s) o «Ya pediste cinco enlaces hoy…» (5 por día)                                                                |

Sin verificar, el menú no recibe pedidos (`unverified`). A los 21 días (`UNVERIFIED_GRACE_DAYS`), queda inactivo (`inactive`). Las rutas con `requireVerifiedEmail`, como invitar, responden `403 EMAIL_NOT_VERIFIED`.

## Objetivo

El enlace del correo confirma la cuenta y abre el panel. Mientras no está verificada, el panel lo dice y permite pedir otro enlace. Así se cierra el criterio de la fase B2 del backend, salvo el correo real.

## Archivos involucrados

- `apps/web/DESIGN.md §7.1` (pantalla nueva `/verificar-correo`) y §6.
- `apps/web/src/routes/(auth)/verificar-correo/+page.server.ts` y `+page.svelte` (nuevas).
- `apps/web/src/routes/app/+layout.server.ts` y `+layout.svelte`: aviso y reenvío.
- `e2e/`: proyecto `integracion`. La fixture toma el token del correo encolado.

## Pasos sugeridos

1. **`DESIGN.md`.** Fila nueva en §7.1 («Confirmar el correo») con sus estados:
   - confirmado → `/app` con «Tu correo quedó confirmado.»;
   - `400` → mensaje de la API y «Reenviar correo» (con sesión) o «Entrar» (sin sesión);
   - `409` → mensaje de la API y «Entrar».
2. **Pantalla.** El `load` llama a `verify-email` y, si responde `200`, hace `redirect(303, '/app')` con un aviso flash, sin el token. La respuesta lleva `cache-control: no-store` y `referrer-policy: no-referrer`.
3. **Aviso en el panel.** Con `emailVerified: false`, una franja arriba de `/app/*`: «Confirma tu correo para que tu menú reciba pedidos.», con «Reenviar correo» (form action). El `202` o el `429` se anuncian con `aria-live="polite"`. Sin `cempasuchil`.
4. **Errores en otras pantallas.** `EMAIL_NOT_VERIFIED` en cualquier action muestra el mensaje de la API y el mismo «Reenviar correo». Lo usa task-31 al invitar.

## Criterios de aceptación

- [ ] El enlace real termina en `/app` con la sesión y `emailVerified: true`. El menú público deja de mostrar `unverified`.
- [ ] El mismo enlace otra vez → `409`; alterado → `400`, con sus mensajes.
- [ ] El aviso del panel aparece sin verificar y desaparece al verificar.
- [ ] Un segundo reenvío dentro de 60 s → mensaje de cuota de la API.
- [ ] 360px, teclado y `aria-live` revisados.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- El correo real en staging o producción: requiere el dominio en Resend (backend T08, un humano).
