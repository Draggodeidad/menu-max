# Task 14 — Términos y aviso del periodo de prueba

**Prioridad:** P1
**Categoría:** Pantalla nueva
**Depende de:** task-01

> No confundir con la task T14 del backend (`apps/api/docs/STATUS.md`): los dos backlogs numeran por separado. Esta task acompaña a T20 y T20b del backend (prueba de 3 meses).

## Contexto

Release 1 es de validación: cada negocio nuevo opera 3 meses sin costo con todas las funciones (backend T20: suscripción `pro` + `trialing` a 90 días). Al terminar, la cuenta pasa sola al plan gratuito con límites, sin perder el servicio ni sus datos (backend T20b). Hoy web no tiene Términos y Condiciones ni dice nada de la prueba: `/` solo muestra "Gratis. Sin tarjeta.".

El texto legal de los Términos lo entrega un humano. Esta task crea la pantalla, la enlaza y deja el texto de la prueba visible donde el dueño decide crear su cuenta.

Web sigue en fase mock (`apps/web/AGENTS.md §0.1`): la fecha de fin de la prueba se simula en `$lib/server/demo.ts` con la forma de `SubscriptionDto` (`status: "trialing"`, `currentPeriodEnd`).

## Objetivo

Quien crea su menú sabe, antes de enviar el formulario, que tiene 3 meses gratis con todo y qué pasa después; y puede leer los Términos completos en una página propia.

## Archivos involucrados

- `apps/web/DESIGN.md`: agregar `/terminos` a §7.1 (fila nueva) y los textos de esta task a §6.
- `apps/web/src/routes/(marketing)/terminos/+page.svelte` (nuevo): contenido estático, prerenderizable.
- `apps/web/src/routes/(marketing)/+page.svelte` y `apps/web/src/routes/crear/+page.svelte`: aviso de la prueba y enlace a los Términos.
- `apps/web/src/routes/app/ajustes/`: fecha en que termina la prueba.
- `apps/web/src/lib/server/demo.ts`: suscripción simulada, `// TEMPORAL`.
- `e2e/flujos.spec.ts`

## Pasos sugeridos

1. Agregar a `DESIGN.md §7.1` la fila `· /terminos · Leer las condiciones del servicio · —` y a §6 los textos de los pasos 3 y 4.
2. Crear `/terminos` con el texto que entregue el humano. Mientras no exista, la página muestra las secciones con un marcador `// TEMPORAL` y **no se publica en producción**. La cláusula de la prueba debe decir, como mínimo:
   - 3 meses sin costo desde que se crea la cuenta, con todas las funciones y sin pedir tarjeta;
   - al cumplirse, la cuenta pasa automáticamente al plan gratuito; no se cobra nada ni se borra información;
   - lo que exceda los límites del plan gratuito se conserva, pero no se puede agregar más;
   - se avisa por correo 15 y 3 días antes.
3. En `/` y `/crear`, junto a "Gratis. Sin tarjeta.": "3 meses gratis con todo. Después sigues en el plan gratuito." y, junto al botón "Publicar menú": "Al publicar aceptas los [Términos](/terminos)." Sin casilla adicional: no se agrega fricción al alta (DESIGN.md, "valor antes que cuenta").
4. En `/app/ajustes`, una línea informativa: "Tu prueba gratis termina el 12 de febrero de 2027." (fecha con `Intl.DateTimeFormat("es-MX")` en la zona de la sucursal). Si la suscripción no está en prueba, no se muestra.
5. Enlace a `/terminos` en el pie de `/` y de `/entrar`.

## Criterios de aceptación

- [ ] `/terminos` aparece en `DESIGN.md §7.1` y respeta tokens, tipografía y vocabulario.
- [ ] `/` y `/crear` muestran el aviso de la prueba y el enlace a los Términos; el alta sigue siendo un solo envío, sin campos nuevos.
- [ ] `/app/ajustes` muestra la fecha de fin de la prueba solo con `status: "trialing"`.
- [ ] Nuevas pruebas en `e2e/flujos.spec.ts`, en ambas resoluciones: el enlace de `/crear` abre `/terminos`; `/terminos` tiene un `h1` y la cláusula de la prueba.
- [ ] `pnpm --filter web check`, `lint` y `test` pasan; revisada a 360px y con teclado.

## Fuera de alcance

- Redactar o validar el texto legal: lo entrega y aprueba un humano.
- Página de precios, comparativa de planes, pagos y descuentos de lanzamiento: Release 2 (pagos en línea están fuera del MVP).
- Avisos de fin de prueba por correo (backend T20b) o dentro del panel.
- Llamar a la API real (`$lib/server/api.ts`) y cualquier cambio en `apps/api`.
