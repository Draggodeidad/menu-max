# Task 17 — Sesión real, `/entrar` y «Salir»

**Prioridad:** P0
**Categoría:** Paridad con la API
**Depende de:** task-16

> No confundir con la task T17 del backend. Consume T07 (sesiones), T09 (bloqueo de login) y T11 (`GET /v1/me`). Matriz: `PARIDAD-API.md` § Identidad y sesión.

## Contexto

`hooks.server.ts` lee una cookie simulada (`demo_sesion`), y `/entrar` la abre con cualquier correo válido. No existe forma de salir. La API tiene:

| Método | Ruta                     | Contrato                                                                                                                                                                    |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/auth/sign-in/email` | `SignInInput { email, password (1–128), rememberMe? }`. `401`: «El correo o la contraseña son incorrectos.» `429` con `Retry-After` tras 5 fallos en 15 min por correo e IP |
| GET    | `/v1/me`                 | `MeDto { user { id, email, name, emailVerified }, memberships [{ orgId, orgName, role }] }`; sin sesión, `401`                                                              |
| POST   | `/v1/auth/sign-out`      | Cierra la sesión y borra la cookie                                                                                                                                          |

La cookie se llama `better-auth.session_token` en development y `__Secure-better-auth.session_token` en los demás entornos.

## Objetivo

Entrar con una cuenta real abre `/app`, y salir cierra la sesión en la API. Sin sesión real, `/app/*` manda a `/entrar`.

## Campos y validaciones

| Pantalla       | Campo                                                       | Contrato                       | Regla en la UI                                              |
| -------------- | ----------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `/entrar`      | Correo                                                      | `SignInInput.email`            | Formato del contrato, en minúsculas                         |
| `/entrar`      | Contraseña                                                  | `SignInInput.password` (1–128) | No vacía, máximo 128; mostrar u ocultar, como hoy           |
| `/entrar`      | «Mantener mi sesión abierta» (casilla, marcada por defecto) | `rememberMe`                   | Desmarcada, la sesión dura lo que el navegador esté abierto |
| `/app/ajustes` | «Salir»                                                     | `POST /v1/auth/sign-out`       | Form action; redirige a `/`                                 |

## Archivos involucrados

- `apps/web/src/hooks.server.ts`, `apps/web/src/app.d.ts` (`locals.session` con la forma de `MeDto`).
- `apps/web/src/lib/server/sesion.ts`.
- `apps/web/src/routes/app/+layout.server.ts`.
- `apps/web/src/routes/(auth)/entrar/+page.server.ts` y `+page.svelte`.
- `apps/web/src/routes/app/ajustes/`: sección «Cuenta» con «Salir». task-21 le agrega el cambio de contraseña.
- `apps/web/DESIGN.md §6` y §7.1 (G y F).
- `e2e/`: proyecto `integracion`.

## Pasos sugeridos

1. **`hooks.server.ts`.** Llama a `GET /v1/me` solo si llega la cookie de sesión y la ruta la necesita (`/app/*`, `/entrar`, `/crear`, `/invitacion`, `/verificar-correo`, `/restablecer`). `/m/*` no paga esa llamada.
   - `401` → sin sesión;
   - `5xx` → error de servicio, sin tratarlo como «sin sesión».
2. **Protección.** `app/+layout.server.ts`:
   - sin sesión → `/entrar`;
   - con sesión y sin membresías (alta a medias, backend T20) → `/crear`, donde task-19 reanuda.

   La organización activa la resuelve task-18; mientras tanto, la primera membresía.

3. **`/entrar`.** Validar con `SignInInput` y llamar con `apiAction`.
   - `401` y `429` → mensaje de la API bajo el formulario, con el correo conservado y la contraseña vacía;
   - éxito → `siguiente ?? '/app'`, con la regla actual de `siguiente`.
4. **«Salir».** Sección «Cuenta» al final de `/app/ajustes` con el correo de la sesión y el botón secundario «Salir». Se agrega a `DESIGN.md §7.1 F`.
5. **Transición.** Hasta que task-19 conecte `/crear`, `hooks.server.ts` acepta también `demo_sesion`, marcado `// TEMPORAL: se borra en task-19`.

## Criterios de aceptación

- [ ] Un usuario real de la fixture entra y ve su organización en `/app`.
- [ ] Contraseña incorrecta → mensaje de la API, con el correo conservado y la contraseña vacía. El sexto intento → mensaje de bloqueo (`429`).
- [ ] Sin «Mantener mi sesión abierta», la cookie no tiene `Max-Age` ni `Expires`; con la casilla, sí.
- [ ] «Salir» cierra la sesión en la API: después, `/app` redirige a `/entrar` y la cookie ya no sirve.
- [ ] Sin cookie, o con una vencida o inventada, `/app` redirige a `/entrar`.
- [ ] `/m/[slug]` no llama a `/v1/me`.
- [ ] `siguiente=/invitacion?token=…` sigue funcionando.
- [ ] `DESIGN.md` describe la casilla y la sección «Cuenta».
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- El selector de organización y de sucursal: task-18.
- Restablecer y cambiar la contraseña: task-21.
