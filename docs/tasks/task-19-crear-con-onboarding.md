# Task 19 — `/crear` y `/app/listo` con `POST /v1/onboarding`

**Prioridad:** P0
**Categoría:** Paridad con la API
**Depende de:** task-16, task-17

> No confundir con la task T19 del backend. Consume T20 (onboarding), T20c (aviso de cuenta existente), T18 (menú publicado) y T19 (QR). Matriz: `PARIDAD-API.md` § Alta.

## Contexto

`/crear` valida su formulario a mano y guarda el menú en una cookie. La API hace el alta completa en una llamada:

- Headers: `Idempotency-Key` (UUID) y `x-turnstile-token`.
- Respuesta `201` → `OnboardingDto { orgId, branchId, menuSlug, menuUrl }` con la cookie de sesión.
- Errores:
  - `400` con `fieldErrors` por ruta (`products.3.name`);
  - `409 CONFLICT` con `ACCOUNT_ALREADY_EXISTS_MESSAGE`;
  - `409 IDEMPOTENCY_CONFLICT`;
  - `429` por 3 altas por IP al día.
- Si el batch falla, la sesión ya existe. Reintentar con la misma llave completa el alta.

## Campos y validaciones (`OnboardingInput`)

| Campo en `/crear`    | Contrato                                                              | Hoy                     | Cambio                                                                                               |
| -------------------- | --------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Nombre del negocio   | `businessName` 1–120, sin caracteres de control                       | 2–60                    | Límites del contrato. La vista previa del enlace usa el mismo slug que la API (`SLUG_PATTERN`, 3–50) |
| Producto: nombre     | `products[].name` 1–80                                                | ≤ 60                    | Límites del contrato                                                                                 |
| Producto: precio     | `products[].priceCents` 0–10,000,000                                  | > $0                    | Se acepta $0 («Gratis» en la vista previa)                                                           |
| Cuántos productos    | 1 a `max_products` del plan `free` (la API responde `400` si se pasa) | Tope fijo de 15         | Sin tope propio: el error de la API aparece en «Productos»                                           |
| Modalidades          | `modes` (al menos una)                                                | Sí                      | Mensaje `MODES_REQUIRED` del contrato                                                                |
| **Mesas** (nuevo)    | `tableCount` 0–200, obligatorio con Mesa                              | No existe               | Campo numérico que aparece al elegir Mesa; mensaje `TABLES_REQUIRED`                                 |
| WhatsApp para avisos | `alertWhatsapp` E.164, opcional                                       | 10 dígitos, obligatorio | Opcional. `+52` por defecto y se acepta cualquier lada (`E164Phone`)                                 |
| Correo               | `account.email`                                                       | Formato propio          | Formato del contrato                                                                                 |
| Contraseña           | `account.password` 10–128                                             | ≥ 8                     | Límites del contrato. Ayuda: «De 10 a 128 caracteres.», como en `/invitacion`                        |
| Turnstile (nuevo)    | Header `x-turnstile-token`                                            | No existe               | `Turnstile.svelte` antes de «Publicar menú»                                                          |
| Llave (nueva)        | Header `Idempotency-Key`                                              | No existe               | Campo oculto generado en `load`                                                                      |

## Archivos involucrados

- `apps/web/src/routes/crear/+page.server.ts` y `+page.svelte`.
- `apps/web/src/routes/app/listo/+page.server.ts` y `+page.svelte`.
- `apps/web/src/lib/server/demo.ts`: se borra todo lo del alta simulada (`CORREO_CON_CUENTA_DEMO`, `COOKIE_PUBLICADO`, `MAX_PRODUCTOS_PUBLICADO`…).
- `apps/web/src/lib/server/sesion.ts` y `hooks.server.ts`: sin la sesión simulada de transición.
- `apps/web/DESIGN.md §6` y §7.1 B (campo de mesas, WhatsApp opcional, Turnstile).
- `e2e/`: task-01 y task-15 pasan al proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md §7.1 B`.** Agregar «Mesas» junto a la modalidad Mesa, WhatsApp opcional con lada y el widget de Turnstile.
2. **Action.** Arma `OnboardingInput` (pesos a centavos, teléfono a E.164), valida con el contrato y llama con `apiAction`.
   - `201` → `/app/listo`.
   - `400` → cada `fieldErrors` bajo su campo.
   - `409 CONFLICT` → estado de task-15.
   - `409 IDEMPOTENCY_CONFLICT` → aviso; se genera una llave nueva.
   - `429` → aviso con el mensaje de la API.
   - `5xx` → «No pudimos publicar tu menú. Inténtalo de nuevo.», con lo capturado y la misma llave.

   La contraseña nunca vuelve en `values`.

3. **Reanudar.** Con sesión y sin organización, `/crear` precarga el borrador (`localStorage`) y la misma llave. El correo es el de la sesión y no se pide contraseña.
4. **`/app/listo`.**
   - El QR sale de `GET …/branches/{branchId}/qr`, como SVG con `{@html}`.
   - El enlace sale de `MenuDto.slug`.
   - Si la sucursal tiene mesas, se ofrece también el QR de cada mesa (`?mesa=n`).
   - «Hacer un pedido de prueba» sigue simulado hasta el backend T21.
5. **Borrar la transición** de task-17: `demo_sesion` y `abrirSesion`.

## Criterios de aceptación

- [ ] Cada fila de la tabla de campos se cumple; los mensajes son los del contrato o los de la API.
- [ ] Un alta con Mesa y 8 mesas deja `tableCount: 8`, y `/app/listo` ofrece el QR de la mesa 1 a la 8.
- [ ] Un producto de $0 se publica.
- [ ] Doble envío o recarga del POST → un solo negocio.
- [ ] Batch fallido en la API local → el reintento con la misma llave completa el alta.
- [ ] Correo registrado → estado de task-15, ahora con el `409` real. Cuarta alta del día desde la misma IP → mensaje del `429`.
- [ ] `demo.ts` ya no tiene nada del alta y la sesión simulada ya no existe.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- El pedido de prueba real: backend T21.
- Fotos, horarios y zonas en el alta: la API no los recibe en `OnboardingInput`; se editan en tasks 25, 27 y 28.
