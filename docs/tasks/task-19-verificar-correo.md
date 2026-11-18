# Task 19 — Verificar el correo y reenviar el enlace

**Prioridad:** P0
**Categoría:** Pantalla nueva · Integración con la API
**Depende de:** task-17, task-18

> No confundir con la task T19 del backend. Esta task consume T10 (verificación y reenvío con cuota) y la regla de ADR-008: una cuenta sin verificar no recibe pedidos de comensales.

## Contexto

Al crear la cuenta, la API encola un correo con el enlace `${WEB_ORIGIN}/verificar-correo?token=…`. Esa pantalla no existe en WEB ni en `DESIGN.md §7`. La API ya tiene:

| Método | Ruta                               | Respuesta                                                                                                                                                           |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/auth/verify-email?token=…`    | `200` con la cookie de sesión. `400`: «El enlace no es válido o ya venció. Solicita otro.» `409`: «Este enlace ya se usó. Si ya confirmaste tu correo, solo entra.» |
| POST   | `/v1/auth/send-verification-email` | Con sesión. `202`: «Si el correo existe, te enviamos un enlace.» `429` con el mensaje de la cuota (1 cada 60 s, 5 por día)                                          |

Mientras el dueño no verifica, su menú se ve pero no recibe pedidos (`notAcceptingReason: "unverified"`). Después de 21 días sin verificar, el menú público queda inactivo (ADR-008). Hoy el panel no avisa nada de esto.

Esta task cierra el criterio de la fase B2 del backend: usuario de prueba → correo → clic → sesión verificada. En local, el correo se lee en la terminal de `wrangler dev`.

## Objetivo

- El enlace del correo confirma la cuenta y abre el panel.
- Mientras la cuenta no está verificada, el panel lo dice y permite pedir otro enlace.

## Archivos involucrados

- `apps/web/DESIGN.md`: pantalla nueva en §7.1 (`/verificar-correo`) y sus textos en §6.
- `apps/web/src/routes/(auth)/verificar-correo/+page.server.ts` y `+page.svelte` (nuevas).
- `apps/web/src/routes/app/+layout.server.ts` y `+layout.svelte`: el aviso de correo sin verificar.
- `e2e/`: pruebas del proyecto `integracion`. La fixture lee el token del correo encolado o del log local.

## Pasos sugeridos

1. **`DESIGN.md` primero.** Agregar `/verificar-correo` a la tabla de §7.1 con su objetivo («Confirmar el correo») y sus estados:
   - confirmado → abre `/app` con «Tu correo quedó confirmado.»;
   - enlace vencido o no válido → el mensaje de la API y la acción para pedir otro (con sesión) o entrar (sin sesión);
   - enlace ya usado → el mensaje de la API y «Entrar».

   Los mensajes de error son los de la API, sin redactar otros.

2. **Pantalla.** El `load` llama a `GET /v1/auth/verify-email` con el token de la URL.
   - `200` → `redirect(303, '/app')` con el aviso de éxito (parámetro o cookie flash, sin el token).
   - `400` y `409` → la pantalla de error.

   El token no se guarda ni se registra, y la respuesta lleva `cache-control: no-store` y `referrer-policy: no-referrer`, igual que `/invitacion`.

3. **Aviso en el panel.** Con `locals.session.user.emailVerified === false`, `/app/*` muestra un aviso persistente, con el texto que fije `DESIGN.md`. Debajo va «Reenviar correo», una form action que llama a `POST /v1/auth/send-verification-email` y muestra el `202` o el `429` de la API con `aria-live="polite"`.
4. **Volver a leer la sesión.** Tras verificar, el aviso desaparece en la siguiente carga, porque `GET /v1/me` ya trae `emailVerified: true`.

## Dudas a resolver antes de empezar

- **Texto y lugar del aviso.** `DESIGN.md` no lo define. Recomendación:
  - texto: «Confirma tu correo para que tu menú reciba pedidos.»;
  - acción: «Reenviar correo»;
  - lugar: una franja arriba del contenido de `/app/*`, sin `cempasuchil`, que en el MVP se reserva para pedidos nuevos.
- **Aviso de la gracia.** ¿Se muestra cuántos días quedan de los 21? La API no lo expone directo (`organizations.created_at` no viaja en `MeDto`). Recomendación: no mostrar días en esta task.

## Criterios de aceptación

- [ ] `DESIGN.md §6` y §7.1 describen la pantalla y el aviso.
- [ ] El enlace real del correo abre `/verificar-correo` y termina en `/app` con la sesión y el correo verificado.
- [ ] Un enlace usado otra vez muestra el `409` de la API; uno alterado, el `400`.
- [ ] El panel avisa mientras la cuenta no está verificada y el aviso desaparece después de verificar.
- [ ] «Reenviar correo» encola otro correo; un segundo intento dentro de 60 s muestra el mensaje de cuota de la API.
- [ ] Funciona a 360px y con teclado; el resultado del reenvío se anuncia con `aria-live`.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- El correo real en staging o producción: requiere dar de alta el dominio en Resend (pendiente de un humano, backend T08).
- Restringir funciones del panel por no verificar: la API ya las bloquea (`EMAIL_NOT_VERIFIED`) y cada pantalla muestra su error.
