# Task 18 — `/crear` y `/app/listo` con `POST /v1/onboarding`

**Prioridad:** P0
**Categoría:** Integración con la API
**Depende de:** task-16, task-17

> No confundir con la task T18 del backend. Esta task consume T20 (`POST /v1/onboarding`), T20c (aviso de cuenta existente), T18 (menú publicado) y T19 (QR).

## Contexto

`/crear` valida el formulario y guarda el menú en una cookie (`COOKIE_PUBLICADO`). task-15 simula el correo ya registrado con `CORREO_CON_CUENTA_DEMO`. La API hace todo en una sola llamada:

- `POST /v1/onboarding` con `OnboardingInput`:
  - `businessName`;
  - `products: [{ name, priceCents }]`;
  - `modes: { table, pickup, delivery }`;
  - `tableCount?` (obligatorio con `table`);
  - `alertWhatsapp?` en E.164;
  - `account: { email, password }`.
- Headers obligatorios: `Idempotency-Key` (UUID) y `x-turnstile-token`.
- `201` → `OnboardingDto { orgId, branchId, menuSlug, menuUrl }` con la cookie de sesión.
- Errores:
  - `400` con `fieldErrors` (incluye más productos que los que admite el plan `free`);
  - `409 CONFLICT` con `ACCOUNT_ALREADY_EXISTS_MESSAGE`;
  - `409 IDEMPOTENCY_CONFLICT`;
  - `429` por la cuota de 3 altas por IP al día.
- Si el batch falla, la cuenta queda creada y con sesión (la cookie llega en el error). Reintentar con la misma llave y la sesión completa el alta.

Hoy WEB y la API no coinciden en estos puntos:

| Campo      | WEB hoy                              | Contrato                                        |
| ---------- | ------------------------------------ | ----------------------------------------------- |
| Contraseña | al menos 8                           | 10 a 128 (`OnboardingInput.account.password`)   |
| WhatsApp   | 10 dígitos                           | E.164 (`+52` + 10 dígitos)                      |
| Productos  | hasta 15 (`MAX_PRODUCTOS_PUBLICADO`) | `max_products` de `free` (50), lo valida la API |
| Nombre     | 2 a 60 caracteres                    | 1 a 120 (`businessName`); productos hasta 80    |
| Mesas      | no se pide                           | `tableCount` obligatorio si eliges Mesa         |

## Objetivo

«Publicar menú» crea de verdad la cuenta y el menú, y abre `/app/listo` con el QR real. Un reintento nunca duplica el negocio. Así se cumple el criterio de cierre de la fase B4 del backend: `/crear` en un solo envío deja un menú publicado con QR.

## Archivos involucrados

- `apps/web/src/routes/crear/+page.server.ts` y `+page.svelte`.
- `apps/web/src/routes/app/listo/+page.server.ts` y `+page.svelte`.
- `apps/web/src/lib/server/demo.ts`: se borran `CORREO_CON_CUENTA_DEMO`, `COOKIE_PUBLICADO`, `MAX_PRODUCTOS_PUBLICADO` y lo que solo usaba el alta simulada.
- `apps/web/src/lib/server/sesion.ts` y `hooks.server.ts`: se quita la sesión simulada de transición (task-17).
- `apps/web/DESIGN.md §6` y §7.1 B, si cambian textos o se agrega el campo de mesas.
- `e2e/`: pruebas del proyecto `integracion`.

## Pasos sugeridos

1. **Llave de idempotencia.** `load` genera un UUID y la pantalla lo manda en un `<input type="hidden" name="idempotencyKey">`, igual que el checkout (`AGENTS.md §6.2`). Un error del servidor devuelve la misma llave en `values`, para que reintentar «Publicar menú» no cree otro negocio.
2. **Turnstile.** Usar `Turnstile.svelte` (task-16) antes del botón. Su error se muestra como el de cualquier campo.
3. **Armar `OnboardingInput` en la action.**
   - Pesos a centavos con `parseMoneyToCents`; WhatsApp a `+52XXXXXXXXXX`.
   - Validar con el esquema del contrato. Las reglas que se repiten en el contrato se quitan de la action.
   - Llamar con `apiAction`.
4. **Respuestas.**
   - `201` → `redirect(303, '/app/listo')`.
   - `400` → `fieldErrors` de la API mapeados a los campos de la pantalla (`businessName` → `nombre`, `products` → `productos`, `account.password` → `contrasena`…).
   - `409 CONFLICT` → el estado de task-15, sin cambiar la pantalla.
   - `429` → aviso con el mensaje de la API.
   - `5xx` → aviso «No pudimos publicar tu menú. Inténtalo de nuevo.», conservando lo capturado y la misma llave.

   La contraseña nunca vuelve en `values`.

5. **Reanudar.** Con sesión y sin organización (task-17 redirige aquí), `/crear` muestra el borrador guardado (`localStorage`) y la misma llave. La API completa el alta sin pedir la contraseña.
6. **`/app/listo`.**
   - toma la sucursal de `GET /v1/orgs/{orgId}/branches` (la primera; ver la duda de varias organizaciones en task-17);
   - lee el menú de esa sucursal (`GET …/branches/{branchId}/menu`, `MenuDto.slug`) y su QR (`GET …/branches/{branchId}/qr`, SVG);
   - el SVG se pinta con `{@html}`, el único caso permitido (`AGENTS.md §5`);
   - «Copiar enlace» usa `${origen de WEB}/m/{slug}`, que es el mismo `menuUrl` del alta;
   - «Hacer un pedido de prueba» sigue en `demo.ts` hasta que existan los pedidos (backend T21).
7. **Borrar la transición.** Se quitan `demo_sesion`, `abrirSesion` y la lectura doble de `hooks.server.ts`.

## Dudas a resolver antes de empezar

- **Número de mesas.** La API exige `tableCount` si se elige Mesa, y `/crear` no lo pide. Opciones:
  - (a) mostrar «¿Cuántas mesas tienes?» solo cuando se elige Mesa, y agregarlo a `DESIGN.md §7.1 B`;
  - (b) quitar Mesa de `/crear` y activarla después en ajustes.

  Recomendación: (a), porque el QR por mesa es parte de la activación.

- **WhatsApp obligatorio.** WEB lo exige y la API lo acepta opcional. Recomendación: mantenerlo obligatorio, como hoy.

## Criterios de aceptación

- [ ] Publicar con datos válidos crea la cuenta y el menú, y `/app/listo` muestra el QR de la API y el enlace `menuUrl`.
- [ ] `GET /v1/public/menus/{slug}` responde con los productos capturados.
- [ ] Enviar dos veces el mismo formulario (doble clic o recarga del POST) deja un solo negocio.
- [ ] Batch fallido simulado en la API local → el reintento con la misma llave completa el alta.
- [ ] Correo ya registrado → el estado de task-15, ahora con el `409` real.
- [ ] Los errores de la API aparecen bajo su campo; la contraseña nunca se devuelve.
- [ ] `demo.ts` ya no tiene nada del alta simulada y `sesion.ts` ya no existe o solo lee la sesión real.
- [ ] Las pruebas de task-01 y task-15 corren en el proyecto `integracion`.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- El pedido de prueba real: depende del backend T21.
- Verificar el correo: task-19.
- Editar productos después del alta: task-22.
