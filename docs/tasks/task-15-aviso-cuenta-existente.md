# Task 15 — Correo ya registrado al publicar el menú

**Prioridad:** P1
**Categoría:** Estado de error
**Depende de:** task-01

> No confundir con la task T15 del backend (`apps/api/docs/STATUS.md`): los dos backlogs numeran por separado. Esta task acompaña a T20 (`POST /v1/onboarding`, #70) y T20c (aviso por correo) del backend.

## Contexto

En el backend, `/crear` envía todo en una sola llamada a `POST /v1/onboarding` (T20). Si el correo ya tiene cuenta, la API responde `409 CONFLICT` con este mensaje:

> «Ya tienes una cuenta con este correo. Entra para publicar tu menú.»

Además, T20c manda un aviso a ese correo con los enlaces a `/entrar` y `/restablecer`. ADR-008 acepta revelar que el correo existe, porque el registro abre sesión de inmediato; lo mitigan Turnstile y la cuota por IP.

Hoy la acción `publicar` de `/crear` no contempla ese caso. Solo valida el formato del correo y siempre publica.

Web sigue en fase mock (`apps/web/AGENTS.md §0.1`): el correo registrado se simula en `$lib/server/demo.ts`. Cuando llegue la API, la acción dejará de comparar contra el mock y usará la respuesta `409`. La pantalla no cambia.

## Objetivo

Quien escribe en `/crear` un correo que ya tiene cuenta:

- entiende qué pasó y cómo seguir;
- no pierde lo que capturó;
- llega a `/entrar` con un solo toque.

## Archivos involucrados

- `apps/web/DESIGN.md`:
  - §6: el texto del error y del enlace;
  - §7.1, pantalla B: una línea sobre este estado.
- `apps/web/src/lib/server/demo.ts`: `CORREO_CON_CUENTA_DEMO = "juan@tacoselguero.mx"` (el dueño simulado), marcado `// TEMPORAL`.
- `apps/web/src/routes/crear/+page.server.ts`: la acción `publicar` responde `fail(409, …)`.
- `apps/web/src/routes/crear/+page.svelte`: el mensaje junto al campo de correo y el enlace «Entrar».
- `e2e/formularios.spec.ts`

## Pasos sugeridos

1. **`DESIGN.md §6`**: agregar el error y el enlace.
   - Error del campo correo: «Ya tienes una cuenta con este correo. Entra para publicar tu menú.» Es el mismo texto que `ACCOUNT_ALREADY_EXISTS_MESSAGE` de `packages/contracts`; no se redacta otro.
   - Enlace junto al error: «Entrar».
   - No se dice que se envió un correo: la API puede omitir el aviso por su cuota (T20c), y el texto debe ser cierto siempre.
2. **Acción `publicar`.** Después de las validaciones actuales y antes de guardar la cookie:
   - si `values.correo` normalizado (minúsculas, sin espacios) es `CORREO_CON_CUENTA_DEMO`, devolver `fail(409, { fieldErrors: { correo: <mensaje> }, values, cuentaExistente: true })`;
   - no publicar ni abrir sesión;
   - `values` conserva nombre, WhatsApp, correo, modalidades y productos;
   - la contraseña nunca se devuelve.
   - Comentario `// TEMPORAL: sin API todavía; con API es el 409 CONFLICT de POST /v1/onboarding`.
3. **Pantalla.** Con `form?.cuentaExistente`:
   - el mensaje se muestra como error del campo correo (`aria-describedby`, `aria-invalid`) y el foco va al primer campo inválido, igual que los demás errores del formulario;
   - debajo, un enlace con estilo de botón secundario: «Entrar» → `/entrar`. Sin el correo en la URL: es dato personal;
   - `/entrar` ya ofrece «¿Olvidaste tu contraseña?», así que no se duplica aquí;
   - el resto del formulario conserva lo capturado; el campo de contraseña queda vacío.
4. **Sin reintentos automáticos ni banderas nuevas.** El estado se ve en local escribiendo el correo simulado.

## Criterios de aceptación

- [ ] `DESIGN.md §6` y §7.1 describen el estado; el texto coincide con el de la API.
- [ ] Publicar con `juan@tacoselguero.mx` deja al usuario en `/crear`:
  - con el mensaje bajo el correo;
  - con nombre, productos y modalidades intactos;
  - con la contraseña vacía;
  - sin cookie de menú publicado ni sesión.
- [ ] El enlace «Entrar» abre `/entrar`; funciona con teclado y a 360px.
- [ ] Con cualquier otro correo válido, el flujo de task-01 sigue igual (redirige a `/app/listo`).
- [ ] Nueva prueba en `e2e/formularios.spec.ts`, en ambas resoluciones:
  - correo con cuenta → mensaje visible y asociado al campo;
  - valores conservados;
  - «Entrar» navega a `/entrar`.
- [ ] `pnpm --filter web check`, `lint` y `test` pasan.

## Fuera de alcance

- El correo de aviso y su cuota (backend T20c) y cualquier cambio en `apps/api`.
- Reanudar el alta después de entrar (`/app` con la misma `Idempotency-Key`). Se hace al integrar la API real: requiere conservar el borrador y la llave en el servidor de WEB.
- Llamar a la API real (`$lib/server/api.ts`) y la pantalla `/restablecer` (pendiente en `DESIGN.md §7`).
