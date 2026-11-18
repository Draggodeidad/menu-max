# Task 17 — Sesión real y `/entrar` con la API

**Prioridad:** P0
**Categoría:** Integración con la API
**Depende de:** task-16

> No confundir con la task T17 del backend. Esta task consume T07 (sesiones de Better Auth), T09 (bloqueo de login) y T11 (membresías en `GET /v1/me`).

## Contexto

`hooks.server.ts` lee hoy una cookie simulada (`demo_sesion`, de `#lib/server/sesion.ts`). `/entrar` abre esa sesión con cualquier correo válido. La API ya tiene:

| Método | Ruta                     | Para qué                                                                                                                            |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/auth/sign-in/email` | Entra y responde `set-cookie`. `401`: «El correo o la contraseña son incorrectos.»; `429` con `Retry-After` tras 5 fallos en 15 min |
| GET    | `/v1/me`                 | `MeDto`: usuario (`emailVerified`) y membresías activas (`orgId`, `orgName`, `role`). Sin sesión, `401`                             |
| POST   | `/v1/auth/sign-out`      | Cierra la sesión y borra la cookie                                                                                                  |

La cookie de Better Auth se llama `better-auth.session_token` en development y `__Secure-better-auth.session_token` en los demás entornos. `api.ts` ya la reenvía en `set-cookie` sin `Domain`, así que queda en el host de WEB.

## Objetivo

Entrar con una cuenta real abre `/app` con la organización de esa cuenta. Un correo o una contraseña incorrectos muestran el mensaje de la API. Sin sesión real, `/app/*` manda a `/entrar`.

## Archivos involucrados

- `apps/web/src/hooks.server.ts` y `apps/web/src/app.d.ts`: `locals.session` con la forma de `MeDto`.
- `apps/web/src/lib/server/sesion.ts`: se reemplaza por la lectura de la sesión real.
- `apps/web/src/routes/app/+layout.server.ts`: protección y organización activa.
- `apps/web/src/routes/(auth)/entrar/+page.server.ts` y `+page.svelte`.
- `e2e/`: pruebas del proyecto `integracion` (task-16).

## Pasos sugeridos

1. **Sesión en `hooks.server.ts`.** Llamar a `GET /v1/me` solo cuando llega la cookie de sesión y la ruta la necesita (`/app/*`, `/entrar`, `/crear`, `/invitacion`). El menú público (`/m/*`) no paga esa llamada.
   - `401` → `locals.session = null`;
   - `5xx` → la página de error de servicio no disponible. No se trata como «sin sesión», para no mandar a `/entrar` a alguien que sí tiene sesión.
2. **Organización activa.** `app/+layout.server.ts` toma la primera membresía y deja `orgId`, `orgName` y `role` en los datos del layout.
   - Sin sesión → `redirect(303, '/entrar')`, como hoy.
   - Con sesión y sin membresías: el alta quedó a medias (backend T20). → `redirect(303, '/crear')`; task-18 reanuda el alta ahí.
3. **`/entrar`.** La action:
   - valida con `SignInInput` de `@menu-max/contracts`;
   - llama a `POST /v1/auth/sign-in/email` con `apiAction` (task-16);
   - `401` y `429` devuelven `fail` con el mensaje de la API como error del formulario, y se conserva el correo;
   - en éxito, `redirect(303, siguiente ?? '/app')`, con la misma regla de `siguiente` que ya existe para volver a `/invitacion`.
4. **Transición.** Mientras task-18 no conecte `/crear`, el alta simulada sigue abriendo `demo_sesion`. `hooks.server.ts` lee primero la sesión real y, si no hay, la simulada, marcada `// TEMPORAL: se borra en task-18`. Esta task no rompe el flujo de task-01.
5. **Cerrar sesión.** La API ya lo permite, pero `DESIGN.md §7` no tiene un lugar para «Salir». Ver «Dudas».

## Dudas a resolver antes de empezar

- **¿Dónde va «Salir»?** `DESIGN.md` no lo define. Recomendación: un enlace «Salir» al final de `/app/ajustes`, como form action `POST` hacia `/v1/auth/sign-out` que redirige a `/`. El texto y el lugar se agregan a `DESIGN.md §6` y §7.1 en esta task.
- **Varias organizaciones.** `MeDto` admite varias membresías, pero `DESIGN.md` no tiene selector. Recomendación: usar la primera y dejar el selector fuera del MVP.

## Criterios de aceptación

- [ ] Con un usuario real creado por la fixture, `/entrar` abre `/app` y el panel muestra el nombre de su organización.
- [ ] Contraseña incorrecta → el mensaje de la API bajo el formulario, con el correo conservado y la contraseña vacía.
- [ ] Seis intentos fallidos → el mensaje de bloqueo de la API (`429`); la pantalla no se rompe.
- [ ] Sin cookie de sesión, `/app` redirige a `/entrar`; con una cookie vencida o inventada, también.
- [ ] `/m/[slug]` no llama a `/v1/me` (se verifica en la prueba de integración).
- [ ] `siguiente=/invitacion?token=…` sigue funcionando después de entrar.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- `/crear` y el borrado de `demo_sesion`: task-18.
- «¿Olvidaste tu contraseña?»: task-20.
- Cambiar la contraseña desde el panel (`POST /v1/auth/change-password`): no está en `DESIGN.md`.
