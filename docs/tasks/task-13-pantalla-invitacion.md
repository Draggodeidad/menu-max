# Task 13 — Pantalla para aceptar una invitación

**Prioridad:** P1
**Categoría:** Pantalla nueva
**Depende de:** task-08

> No confundir con la task T13 del backend (`apps/api/docs/STATUS.md`): los dos backlogs numeran por separado. Esta task es la pantalla que consume lo que entregó T13 (PR #49).

## Contexto

El correo de invitación de T13 enlaza a `${WEB_ORIGIN}/invitacion?token=…`, pero esa pantalla no existe en web ni en `apps/web/DESIGN.md §7`. La API ya expone, detrás del Service Binding:

- `GET /v1/public/invitations/:token` → `InvitationPreviewDto`: `{ orgName, role, emailMasked, expired, accountExists }`. Si la invitación no existe, ya se aceptó o se revocó, responde 404.
- `POST /v1/public/invitations/:token/accept` → `{ orgId }`, y la cookie de sesión cuando se crea una cuenta. Hay tres casos:
  - con sesión y el mismo correo: cuerpo vacío;
  - sin sesión y sin cuenta: `{ name, password }` y Turnstile en `x-turnstile-token`;
  - sin sesión y con cuenta: 401 "Entra con tu cuenta para aceptar la invitación.".

Errores que la pantalla debe distinguir:

| Caso                                          | Código                | Mensaje de la API                                                    |
| --------------------------------------------- | --------------------- | -------------------------------------------------------------------- |
| No existe, aceptada o revocada (vista previa) | `NOT_FOUND` (404)     | "Esta invitación ya no es válida. Pide una nueva a quien te invitó." |
| Ya se usó (al aceptar)                        | `CONFLICT` (409)      | "Esta invitación ya se usó."                                         |
| Es para otro correo                           | `CONFLICT` (409)      | "Esta invitación es para otro correo."                               |
| Ya es miembro                                 | `CONFLICT` (409)      | "Ya eres miembro de esta organización."                              |
| Vencida o cancelada                           | `BUSINESS_RULE` (422) | "Esta invitación venció…" / "Esta invitación se canceló…"            |
| Datos o Turnstile inválidos                   | `VALIDATION_FAILED`   | Con `fieldErrors` en `name`, `password` o `turnstileToken`           |

Web sigue en fase mock (`apps/web/AGENTS.md §0.1`): esta task simula la API en `$lib/server/demo.ts` con esas mismas formas. La pantalla debe quedar lista para cambiar el mock por `$lib/server/api.ts` sin tocar sus componentes.

## Objetivo

Quien abre el enlace entiende a qué organización y con qué rol lo invitaron, y acepta en un solo paso: crea su cuenta si no tiene, entra si ya tiene o acepta directo si ya tiene sesión. Si la invitación no sirve, ve un error claro que le dice qué hacer.

## Archivos involucrados

- `apps/web/DESIGN.md`: agregar `/invitacion` a §7.1 (fila nueva y boceto), con los textos de esta task.
- `apps/web/src/routes/(auth)/invitacion/+page.server.ts` (nuevo)
- `apps/web/src/routes/(auth)/invitacion/+page.svelte` (nuevo)
- `apps/web/src/lib/server/demo.ts`: invitaciones simuladas, `// TEMPORAL`.
- `apps/web/src/routes/(auth)/entrar/+page.server.ts`: volver a la invitación después de entrar.
- `e2e/flujos.spec.ts` y `e2e/helpers.ts`

## Pasos sugeridos

1. Agregar la pantalla a `DESIGN.md §7.1`:
   - fila: `H · /invitacion · Unirse al equipo de un negocio · "Aceptar invitación"`;
   - boceto: nombre de la organización, rol y correo enmascarado arriba; debajo, el formulario o el mensaje según el estado.
   - Roles en la UI: `owner` → "dueño", `admin` → "administrador", `staff` → "personal".
2. Modelar en `demo.ts` una función que, dado el token, devuelva un `InvitationPreviewDto` o "no válida", y otra que simule aceptar con los errores de la tabla. En desarrollo, una bandera `?estado=` (`vencida`, `invalida`, `con-cuenta`, `otro-correo`, `miembro`) muestra cada caso; nunca en producción.
3. `load` lee `token` de la URL, carga la vista previa y la sesión simulada de `event.locals`. Responde con `setHeaders({ "cache-control": "no-store" })`: el token es una credencial y la página no se cachea.
4. Mostrar según el estado:
   - **no válida** (404): el mensaje de la API y un enlace a `/`;
   - **vencida**: "Esta invitación venció. Pide una nueva a quien te invitó.", sin formulario;
   - **sin sesión y sin cuenta**: nombre, contraseña (10 a 128 caracteres) y el lugar del widget de Turnstile, marcado `// TEMPORAL` hasta integrar la API. Botón "Aceptar invitación" → "Aceptando…";
   - **sin sesión y con cuenta**: "Entra con tu cuenta para aceptar la invitación." y un botón "Entrar" a `/entrar?siguiente=/invitacion?token=…`;
   - **con sesión**: solo el botón "Aceptar invitación".
5. La action `?/aceptar`:
   - valida lo mínimo en servidor;
   - muestra los `fieldErrors` bajo cada campo con `aria-invalid` y `aria-describedby`, y los errores 409/422 en un aviso con `role="alert"`;
   - al aceptar, abre la sesión simulada y hace `redirect(303, "/app")`.
6. En `/entrar`, aceptar `siguiente` solo si empieza con `/invitacion?token=`, para no abrir una redirección a cualquier sitio. Sin ese valor, el comportamiento actual no cambia.
7. Agregar `<meta name="referrer" content="no-referrer">` en la página para que el token no salga en el `Referer`. No cargar recursos de terceros fuera de Turnstile.

## Criterios de aceptación

- [ ] `/invitacion` aparece en `DESIGN.md §7.1` y la pantalla respeta tokens, tipografía, textos (§6) y vocabulario.
- [ ] Cada estado de los pasos 4 y 5 se ve con su bandera `?estado=` en desarrollo.
- [ ] El formulario funciona sin JavaScript; con `use:enhance` muestra "Aceptando…" y lleva el foco al primer error.
- [ ] Nuevas pruebas en `e2e/flujos.spec.ts`, en ambas resoluciones:
  - aceptar sin cuenta abre `/app`;
  - una invitación vencida no muestra el formulario;
  - una invitación no válida muestra el mensaje y el enlace a `/`;
  - con cuenta, el botón "Entrar" vuelve a la invitación después de entrar.
- [ ] `/entrar?siguiente=https://otro.sitio` ignora `siguiente`.
- [ ] La respuesta de `/invitacion` lleva `cache-control: no-store`.
- [ ] `pnpm --filter web check`, `lint` y `test` pasan; revisada a 360px y con teclado.

## Fuera de alcance

- Llamar a la API real (`$lib/server/api.ts`) y el widget real de Turnstile: llegan cuando web deje la fase mock.
- Enviar correos, invitar o gestionar miembros desde `/app/ajustes` (ver task-11).
- Cualquier cambio en `apps/api`.
