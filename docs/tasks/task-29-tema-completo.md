# Task 29 — Tema completo del menú

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-25, task-32

> No confundir con la task T29 del backend (no existe). Consume T18 (tema con contraste AA) y T14b (capacidades del plan). Matriz: `PARIDAD-API.md` § Menú público, tema, publicación y QR.

## Contexto

La sección Tema tiene preset, color primario y fuente. La API guarda más (`GET` y `PUT …/menu/theme`):

- `UpdateThemeInput`, con `version` (`0` si nunca se guardó). Lo omitido se conserva; `null` vuelve al valor del preset o quita la imagen.
- Sin la capacidad `customTheme` (plan `free`), solo acepta `preset` y `primaryColor`.
- Poner `showBranding: false` exige `removeBranding`.
- Lo que el plan no permite → `402 PLAN_LIMIT_REACHED`.
- La API valida el contraste AA (`MIN_CONTRAST_RATIO` 4.5:1) del color principal y del color del texto contra el fondo. Si no alcanza, responde `400` con `fieldErrors` en ese color, y el mensaje sugiere oscurecerlo o aclararlo.
- `ThemeDto` es lo guardado; el comensal ve el tema efectivo según el plan (`PublicThemeDto`).

## Campos y validaciones

| Control                        | Contrato                                           | Hoy                | Cambio                                               |
| ------------------------------ | -------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| Preset                         | `preset`: `minimal`, `dark`, `vibrant`             | Sí                 | Conectar                                             |
| Color principal                | `primaryColor` `#RRGGBB` o `null`                  | Sí («Restablecer») | Conectar                                             |
| Color de fondo                 | `backgroundColor`                                  | No existe          | `type="color"`; requiere `customTheme`               |
| Color de texto                 | `textColor`                                        | No existe          | `type="color"`; requiere `customTheme`               |
| Fuente                         | `fontPreset`: `sans`, `rounded`, `serif`           | Sí                 | Conectar; requiere `customTheme`                     |
| Acomodo de productos           | `productLayout`: `list`, `grid` (`DESIGN.md §7.2`) | No existe          | Radio «Lista» / «Cuadrícula»; requiere `customTheme` |
| Logo                           | `logoAssetId`                                      | No existe          | `ImageUpload` (task-25)                              |
| Portada                        | `coverAssetId`                                     | No existe          | `ImageUpload` (task-25)                              |
| «Mostrar “Hecho con MenusMax”» | `showBranding`                                     | No existe          | `Switch`; apagarlo requiere `removeBranding`         |

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/SeccionTema.svelte` y `+page.server.ts`.
- `apps/web/DESIGN.md §7.1 F` y §6.
- `e2e/`: proyecto `integracion`, con una organización `free` y otra `pro`.

## Pasos sugeridos

1. **Capacidades.**
   - Para `owner`, el `load` lee `features` de `GET /subscription`, y lo que el plan no incluye se muestra deshabilitado con «Disponible en Pro».
   - `admin` también edita el tema (`settings:write`), pero no tiene `subscription:read`. Hasta el pedido al backend n.º 4 de `PARIDAD-API.md`, ve los controles habilitados, y el `402` de la API explica el límite al guardar. No se duplica la tabla de planes en WEB.
2. **Guardar.** «Guardar cambios» manda solo lo que cambió, con la `version`.
   - `402` → mensaje de la API;
   - contraste insuficiente (`400`) → mensaje bajo el color;
   - `409` → datos recién leídos.
3. **Vista previa.** La vista previa local usa los mismos derivados que el menú público (`DESIGN.md §3.6`) y advierte el contraste antes de guardar.

## Criterios de aceptación

- [ ] En `pro`, cada control de la tabla se guarda y el menú público lo refleja.
- [ ] En `free`, solo preset y color principal se editan; los demás están deshabilitados con su motivo; forzar el envío → `402`.
- [ ] Un color de texto sin contraste AA con el fondo → mensaje de la API bajo el campo.
- [ ] «Restablecer» (`null`) vuelve al color del preset.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Cobro o cambio de plan: Release 2.
