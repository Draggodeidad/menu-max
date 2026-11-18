# Task 31 — Equipo: miembros, sucursales del personal e invitaciones

**Prioridad:** P1
**Categoría:** Paridad con la API
**Depende de:** task-18, task-20

> No confundir con la task T31 del backend (no existe). Consume T13 (invitaciones y miembros), T12 (políticas) y T14 (límite de miembros). Matriz: `PARIDAD-API.md` § Equipo, plan e invitaciones.

## Contexto

La sección Equipo invita con correo y rol, cambia el rol y quita miembros, todo simulado: «El colaborador quedará pendiente y no recibirá ningún correo.». La API soporta además sucursales por miembro, la lista de invitaciones con su vencimiento y cancelarlas:

| Ruta                       | Contrato                                                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /members`             | `MemberListDto` paginado: `name`, `email`, `role`, `branchIds`, `createdAt`                                                                                              |
| `PATCH /members/{id}`      | `UpdateMemberInput { role?, branchIds? }`: al menos uno                                                                                                                  |
| `DELETE /members/{id}`     | Quitar al último dueño → `422` con `LAST_OWNER_MESSAGE`                                                                                                                  |
| `GET /invitations`         | `InvitationListDto` paginado: `email`, `role`, `branchIds`, `expired`, `expiresAt`                                                                                       |
| `POST /invitations`        | `CreateInvitationInput { email, role, branchIds? }`. Con correo verificado (`403 EMAIL_NOT_VERIFIED`), 20 por día por organización (`429`) y límite `maxMembers` (`402`) |
| `DELETE /invitations/{id}` | Cancela la invitación                                                                                                                                                    |

Reglas (ADR-007):

- `owner` invita y gestiona cualquier rol;
- `admin` solo invita y gestiona `staff`, y no modifica a un `owner`;
- `staff` no gestiona a nadie;
- `staff` necesita al menos una sucursal (`STAFF_BRANCHES_REQUIRED`); `owner` y `admin` no llevan sucursales (`BRANCHES_ONLY_FOR_STAFF`).

## Campos y validaciones

| Control                                | Contrato                                   | Hoy                  | Cambio                                                          |
| -------------------------------------- | ------------------------------------------ | -------------------- | --------------------------------------------------------------- |
| Correo a invitar                       | `email` ≤ 254                              | Sí                   | Conectar                                                        |
| Rol                                    | `role`; opciones según quien invita        | Todos                | `owner`: dueño, administrador, personal. `admin`: solo personal |
| Sucursales del personal (nuevo)        | `branchIds` 1–100, obligatorio con `staff` | No existe            | Casillas con las sucursales; solo con «personal»                |
| Cambiar rol o sucursales de un miembro | `PATCH /members/{id}`                      | Solo rol             | Rol y sucursales                                                |
| Quitar miembro                         | `DELETE`                                   | Sí                   | `AlertDialog`; `422` del último dueño                           |
| Invitaciones pendientes (nuevo)        | `GET /invitations`                         | Etiqueta «pendiente» | Lista con «Vence el {fecha}» o «Vencida»                        |
| Cancelar invitación (nuevo)            | `DELETE /invitations/{id}`                 | No existe            | Botón secundario                                                |
| Listas largas                          | `nextCursor`                               | No existe            | «Ver más» (task-16)                                             |

## Archivos involucrados

- `apps/web/src/routes/app/ajustes/SeccionEquipo.svelte` y `+page.server.ts`. Se quita el texto de demostración.
- `apps/web/src/lib/server/demo.ts`: se borra el equipo simulado.
- `apps/web/DESIGN.md §7.1 F` y §6.
- `e2e/`: proyecto `integracion`. El correo de invitación se toma de la cola local.

## Pasos sugeridos

1. **`DESIGN.md`.** Equipo en dos listas, «Miembros» e «Invitaciones pendientes». Al elegir «personal», aparecen las casillas de sucursales.
2. **Opciones según quien mira.** Con el helper de task-18:
   - el selector de rol solo ofrece lo que `canInviteMember` permite;
   - las filas de `owner` no tienen acciones para un `admin`;
   - el miembro actual no puede quitarse a sí mismo si es el último dueño (la API lo confirma con `422`).
3. **Errores.**
   - `EMAIL_NOT_VERIFIED` → mensaje y «Reenviar correo» (task-20);
   - `402` → mensaje de la API, con el uso y el límite del plan (task-32);
   - `429` → mensaje de la API;
   - `fieldErrors.branchIds` → bajo las casillas.

## Criterios de aceptación

- [ ] Invitar personal con dos sucursales crea la invitación, que aparece en la lista con su vencimiento; su correo se encola.
- [ ] Invitar personal sin sucursales → `STAFF_BRANCHES_REQUIRED` sin llamar a la API.
- [ ] Un `admin` solo puede invitar y gestionar personal.
- [ ] Cambiar las sucursales de un miembro `staff` limita lo que ve (task-18).
- [ ] Cancelar una invitación hace que su enlace muestre «No válida» (task-22).
- [ ] Quitar al último dueño → mensaje de la API.
- [ ] Sin correo verificado, invitar → `EMAIL_NOT_VERIFIED` con reenvío.
- [ ] En `free`, superar `maxMembers` → `402`.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Transferir la propiedad o roles personalizados: no están en la API.
