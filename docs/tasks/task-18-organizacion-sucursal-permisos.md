# Task 18 — Organización y sucursal activas, y permisos por rol

**Prioridad:** P0
**Categoría:** Paridad con la API
**Depende de:** task-17 · **Bloqueada por:** el pedido al backend n.º 1 de `PARIDAD-API.md` (matriz de permisos en el contrato)

> No confundir con la task T18 del backend. Consume T11 (tenancy), T12 (RBAC + ABAC, ADR-007) y T15 (sucursales). Matriz: `PARIDAD-API.md` § Organización, sucursales y permisos.

## Contexto

Todas las rutas privadas de la API llevan el tenant en la URL: `/v1/orgs/{orgId}/…` y `/branches/{branchId}/…`. La API soporta:

- **Varias organizaciones por usuario.** `MeDto.memberships` y `GET /v1/orgs/{orgId}`, que devuelve `OrganizationDto { id, name, role }`.
- **Varias sucursales por organización.** `GET /v1/orgs/{orgId}/branches` es paginado (`items`, `nextCursor`); el plan `pro` permite 5. `staff` solo ve y opera las sucursales que tiene asignadas: la API filtra.
- **Permisos por rol** (`ROLE_PERMISSIONS`, ADR-007):

| Permiso                                                                      | `owner` | `admin`      | `staff` |
| ---------------------------------------------------------------------------- | ------- | ------------ | ------- |
| `catalog:write`, `storefront:publish`, `settings:write`, `branches:manage`   | Sí      | Sí           | No      |
| `catalog:availability`, `catalog:read`, `settings:read`, `organization:read` | Sí      | Sí           | Sí      |
| `members:manage`                                                             | Sí      | Solo `staff` | No      |
| `subscription:read`                                                          | Sí      | No           | No      |

Hoy WEB supone una sola organización y una sola sucursal, y muestra todos los controles a todos.

## Objetivo

- El panel siempre sabe en qué organización y sucursal trabaja, y permite cambiar de una a otra.
- Ningún control que el rol no permite aparece en pantalla.

## Archivos involucrados

- `apps/web/src/routes/app/+layout.server.ts` y `+layout.svelte`: contexto y selectores.
- `apps/web/src/lib/server/`: lectura del contexto activo, en el archivo de sesión de task-17 (sin carpetas nuevas).
- `apps/web/DESIGN.md §7.1 D` (navegación del panel) y §6.
- `e2e/`: proyecto `integracion`, con una fixture de usuario con dos organizaciones y otra de `staff` con una sucursal asignada.

## Pasos sugeridos

1. **Organización activa.** Cookie `httpOnly` con el `orgId` elegido. Si no está en las membresías, se usa la primera. Con más de una membresía, un selector en la navegación del panel (sidebar en desktop, `Sheet` en móvil) muestra `orgName` y el rol en español («dueño», «administrador», «personal»).
2. **Sucursal activa.** Cookie `httpOnly` con el `branchId`, validado contra `GET /branches`. Con más de una sucursal, un selector junto al de la organización. Lista larga → «Ver más» con el helper de paginación de task-16.
3. **Permisos.** Un helper `puede(rol, permiso)` que lee `ROLE_PERMISSIONS` de `@menu-max/contracts`, que llega con el pedido al backend n.º 1. Cada pantalla oculta lo que no corresponde:
   - `staff` solo ve el catálogo con el control de disponibilidad, y los ajustes en solo lectura;
   - `admin` no ve «Plan» ni puede invitar dueños o administradores.

   La API sigue siendo quien decide: un `403` igual se muestra con su mensaje.

4. **Cambiar de organización o sucursal** recarga los datos del panel (`invalidateAll`). No mezcla datos de la anterior.

## Criterios de aceptación

- [ ] Un usuario con dos organizaciones las ve en el selector y cambia de una a otra; los datos del panel cambian.
- [ ] Una organización con dos sucursales permite elegir la sucursal; ajustes, catálogo y QR usan la elegida.
- [ ] Un `staff` asignado a una sucursal solo ve esa sucursal y solo puede cambiar la disponibilidad de productos.
- [ ] Un `admin` no ve «Plan» y solo puede invitar personal.
- [ ] Una cookie con un `orgId` o `branchId` ajeno no da acceso: se ignora y se usa el primero válido.
- [ ] `DESIGN.md` describe los selectores.
- [ ] `pnpm --filter web check`, `lint`, `test` y el proyecto `integracion` pasan.

## Fuera de alcance

- Crear sucursales: task-26.
- Borrar la organización: la API tiene el permiso `organization:delete`, pero no la ruta.
