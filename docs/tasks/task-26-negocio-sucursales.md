# Task 26 — Negocio y sucursales: datos, modalidades, mesas y nuevas sucursales

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-18

> No confundir con la task T26 del backend. Consume T15 (negocio y sucursales) y T14 (límite de sucursales). Matriz: `PARIDAD-API.md` § Organización, sucursales y permisos.

## Contexto

En `/app/ajustes`, la sección Servicio tiene modalidades, apertura, cierre y «Tiempo promedio cocina». La sección QR tiene las mesas. La API soporta más campos y varias sucursales:

| Ruta                                     | Contrato                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `GET`, `PATCH /v1/orgs/{orgId}/business` | `UpdateBusinessInput { name (1–120) }`                                        |
| `GET /branches/{branchId}`               | `BranchDetailDto`: los campos de abajo, `version` y `hours`                   |
| `PATCH /branches/{branchId}`             | `UpdateBranchInput`, parcial con `version`; `null` borra el valor             |
| `POST /branches`                         | `CreateBranchInput`; `402` si el plan no admite otra sucursal (`maxBranches`) |

## Campos y validaciones

| Control                | Contrato                                                     | Hoy              | Cambio                                                                                      |
| ---------------------- | ------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------- |
| Nombre del negocio     | `business.name` 1–120                                        | No existe        | Campo en «Negocio»                                                                          |
| Nombre de la sucursal  | `name` 1–120                                                 | No existe        | Campo                                                                                       |
| Zona horaria           | `timezone` IANA (`America/Mexico_City` por defecto)          | No existe        | `<select>` con las zonas de México primero y «Otras» después                                |
| Teléfono de contacto   | `contactPhone` E.164 o `null`                                | No existe        | `type="tel"`, `+52` por defecto. Lo ve el comensal («Llamar al negocio»)                    |
| Modalidades            | `modes` (al menos una; `MODES_REQUIRED`)                     | Casillas         | Conectar con `version`                                                                      |
| Mesas                  | `tableCount` 0–200; obligatorio con Mesa (`TABLES_REQUIRED`) | En la sección QR | Se mueve junto a la modalidad Mesa                                                          |
| Pedido máximo          | `maxOrderTotalCents` 1–100,000,000 o `null`                  | No existe        | Monto en pesos opcional, con ayuda: «Rechaza pedidos por encima de este total.»             |
| WhatsApp para avisos   | `alertWhatsapp` E.164 o `null`                               | Solo en `/crear` | Campo, con el texto de consentimiento: «Confirmo que este número acepta avisos de pedidos.» |
| Tiempo promedio cocina | No existe en la API                                          | Campo numérico   | **Se quita** (`PARIDAD-API.md` § Lo que la UI tiene y la API no)                            |
| Agregar sucursal       | `CreateBranchInput` (mismos campos)                          | No existe        | Formulario corto en un `Sheet`; al crear, la sucursal queda activa (task-18)                |

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/+page.server.ts`, `+page.svelte`, `SeccionServicio.svelte` y `SeccionQr.svelte`. Sección nueva «Negocio» dentro de `+page.svelte`, sin archivo nuevo si se usa en una sola ruta.
- `apps/web/src/lib/server/demo.ts`: se borra el servicio simulado.
- `apps/web/DESIGN.md §7.1 F` y §6.
- `e2e/`: proyecto `integracion`.

## Pasos sugeridos

1. **`DESIGN.md §7.1 F`.** Secciones «Negocio» (nombre del negocio, sucursales, «Agregar sucursal») y «Servicio» (los campos de la tabla).
2. **Actions.**
   - `negocio` → `PATCH /business`;
   - `servicio` → un solo `PATCH /branches/{id}` con los campos cambiados y la `version`;
   - `agregarSucursal` → `POST /branches`.

   Todo se valida con el contrato.

3. **Errores.**
   - `400` → bajo cada campo;
   - `409` → aviso y datos recién leídos;
   - `402` → mensaje de la API junto a «Agregar sucursal», con el uso y el límite del plan (task-32).
4. **Rol.** Sin `settings:write`, la sección es de solo lectura. Sin `branches:manage`, no aparece «Agregar sucursal».

## Criterios de aceptación

- [ ] Cada campo de la tabla se guarda y persiste; el menú público refleja teléfono, modalidades y mesas.
- [ ] «Tiempo promedio cocina» ya no existe.
- [ ] Quitar Mesa con mesas, o dejar Mesa sin mesas, muestra `TABLES_REQUIRED`; quitar todas las modalidades, `MODES_REQUIRED`.
- [ ] En `free`, la segunda sucursal muestra el `402` de la API. En `pro`, se crea y queda activa.
- [ ] `staff` ve la sección en solo lectura.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Horarios: task-27. Zonas: task-28. QR: task-30.
- Opt-in de WhatsApp con Meta (`alertOptInAt`): backend T24.
