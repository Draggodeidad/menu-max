# Fase B3 — Tenancy y permisos

> Planeación del backend (versionada en git).
> **Criterio para cerrar la fase:** roles, invitaciones y límites del plan funcionan; la suite de aislamiento confirma que una organización no lee ni modifica otra.
> **Orden de ejecución:** T11 → T14b, en orden numérico.
> **Nota:** en esta fase las organizaciones de prueba se crean con factories. El alta real (`/crear`) llega en T20.

---

## T11 — Tenancy: organizaciones, membresías y sucursales base

**Fase:** B3 · **Depende de:** T07 · **ADR:** 006 · **Rama sugerida:** `feat/t11-tenancy`

### Objetivo

Cada petición privada sabe en qué organización opera el usuario y con qué rol, y un recurso de otra organización simplemente no existe para él.

### Alcance

- Tablas y migración:
  - `organizations (id, name, created_at, updated_at)`;
  - `organization_members (id, organization_id, user_id, role check in ('owner','admin','staff'), status check in ('active','removed'), created_at, updated_at)`, único `(organization_id, user_id)`;
  - `businesses (id, organization_id, name, created_at, updated_at)`;
  - `branches (id, organization_id, business_id, name, timezone default 'America/Mexico_City', created_at, updated_at)` — columnas de operación llegan en T15;
  - `member_branches (organization_id, member_id, branch_id)`, PK `(member_id, branch_id)`.
- `middleware/tenant.ts`:
  - `requireMembership()` lee `:orgId`, carga la membresía `active` de `(orgId, user.id)` y sus `branchIds`; sin membresía → `NOT_FOUND`; deja `c.var.tenant = { orgId, memberId, role, branchIds }`.
  - `requireBranch()` verifica que `:branchId` pertenezca a `tenant.orgId`; si no → `NOT_FOUND`.
- Montaje en `app.ts` de `orgScoped` en `/v1/orgs/:orgId` con `requireAuth` + `requireMembership()` (ver `apps/api/AGENTS.md §5`).
- `GET /v1/me` agrega `memberships: [{ orgId, orgName, role }]`.
- `GET /v1/orgs/:orgId` → `{ id, name, role }`.
- `apps/api/test/factories.ts`: `createUser`, `createOrg({ ownerId })`, `addMember`, `createBranch`, para todas las pruebas siguientes.

### Fuera de alcance

- Permisos por rol (T12), invitaciones (T13), planes (T14), datos operativos de sucursal (T15).
- Crear organizaciones por API (llega con el onboarding en T20).

### Pruebas requeridas

- [ ] Miembro activo → 200 en `GET /v1/orgs/:orgId`.
- [ ] Usuario sin membresía o con membresía `removed` → 404.
- [ ] `requireBranch` con una sucursal de otra organización → 404.
- [ ] `GET /v1/me` lista solo las membresías activas del usuario.

### Criterios de aceptación

- [ ] Toda tabla nueva tiene `organization_id` con FK e índice compuesto que empieza por él.
- [ ] `eslint-plugin-drizzle` activo con `enforce-update-with-where` y `enforce-delete-with-where`.

---

## T12 — Autorización RBAC + ABAC

**Fase:** B3 · **Depende de:** T11 · **ADR:** 007 · **Rama sugerida:** `feat/t12-authz`

### Objetivo

Cada ruta privada declara su permiso y cada servicio puede preguntar a una política pura si una acción sobre un recurso concreto está permitida.

### Alcance

- `shared/authz/permissions.ts`: tipo `Permission` y `ROLE_PERMISSIONS` exactamente como la matriz de ADR-007 (incluye `organization:read`, `catalog:read` y `settings:read` para los tres roles); `hasPermission(role, permission)`.
- `shared/authz/result.ts`: `allow()`, `deny(code)` y `assertAllowed(result)` que lanza `AppError`.
- `shared/authz/policies.ts` con las políticas de esta fase:
  - `canAccessBranch(tenant, branchId)`: `owner`/`admin` cualquiera de su org; `staff` solo sus `branchIds` (si no, `NOT_FOUND`);
  - `canManageMember(tenant, target, change)`: `admin` solo gestiona `staff`; nadie modifica a un `owner` salvo otro `owner`; no se elimina ni degrada al último `owner`.
- `middleware/authz.ts`:
  - `requirePermission(permission)` devuelve un middleware con la propiedad `permission` (marca usada por la prueba de guardas);
  - `requireVerifiedEmail()` → `EMAIL_NOT_VERIFIED`.
- `GET /v1/orgs/:orgId` pasa a exigir `requirePermission('organization:read')`.
- **Prueba de guardas:** recorre `app.routes`; para cada combinación método + ruta bajo `/v1/orgs/` exige al menos un handler con la marca `permission`. Lista de excepciones vacía.
- **Helper de aislamiento** en `test/isolation.ts`: dada una ruta y un recurso de la org A, la llama como miembro de la org B y espera 404; se reutiliza en todas las tasks siguientes.

### Fuera de alcance

- Políticas de pedidos (T23), de límites (T14) y de catálogo (T16): se agregan en su task.
- Roles personalizados.

### Pruebas requeridas

- [ ] Tabla rol × permiso: cada combinación de ADR-007 devuelve lo esperado.
- [ ] `canAccessBranch`: `staff` asignado sí, no asignado → `NOT_FOUND`.
- [ ] `canManageMember`: `admin` sobre `owner` → `FORBIDDEN`; quitar al último `owner` → `BUSINESS_RULE`.
- [ ] Usuario sin verificar en ruta con `requireVerifiedEmail` → 403 `EMAIL_NOT_VERIFIED`.
- [ ] La prueba de guardas falla si se registra una ruta privada sin `requirePermission` (agrega una ruta de prueba temporal en el test y verifica que falla).

### Criterios de aceptación

- [ ] `permissions.ts` es el único lugar con la relación rol → permiso.
- [ ] Las políticas no hacen I/O y tienen cobertura de todas sus ramas.

---

## T12b — Regla local de oxlint: `update` y `delete` siempre con `where`

**Fase:** B3 · **Depende de:** T11 · **ADR:** 006 · **Rama sugerida:** `chore/t12b-lint-drizzle-where` · **Bloquea:** T13

### Objetivo

Ningún `db.update(...)` ni `db.delete(...)` de Drizzle llega a `main` sin `.where(...)`, verificado por `pnpm lint` y por `lefthook`, sin dependencias nuevas.

### Contexto

T11 debía activar `eslint-plugin-drizzle` (`enforce-update-with-where` y `enforce-delete-with-where`, ADR-006). El plugin no carga bajo oxlint: importa `@typescript-eslint/utils` sin declararlo, y pnpm agrega `eslint` como peer (~73 paquetes), fuera de la lista permitida. T11 se fusionó con ese criterio sin marcar (ver su PR).

### Alcance

- Regla local de oxlint cargada con `jsPlugins` en `.oxlintrc.json`, **sin dependencias nuevas**, que replique `enforce-update-with-where` y `enforce-delete-with-where`:
  - reporta `<db>.update(tabla).set(...)` y `<db>.delete(tabla)` cuando la cadena no termina pasando por `.where(...)`;
  - el nombre del objeto `db` es configurable en las opciones de la regla (por defecto `["db"]`; el repo usa también `database` en `test/factories.ts`);
  - cubre las llamadas dentro de `db.batch([...])`;
  - aplica a `apps/api/**` y `packages/database/**`.
- Pruebas de la regla: para `update` y para `delete`, al menos un caso que pasa (con `where`) y uno que falla (sin `where`), incluido un caso dentro de `db.batch([...])`.
- Enmienda a ADR-006: la verificación se implementa como regla local porque el plugin oficial no carga bajo oxlint; se vuelve al plugin oficial si corrige sus dependencias. (ADR.md pide no editar un ADR `Aceptado` sino escribir uno que lo reemplace: confirmar con el humano si va como ADR nuevo o como nota en ADR-006.)
- Corregir `apps/api/AGENTS.md`:
  - §2: `pnpm --filter api lint` dice "eslint + prettier"; hoy es `oxlint` + `oxfmt`;
  - §1: la lista de dependencias de desarrollo incluye `eslint-plugin-drizzle`; reemplazarla por la regla local.

### Fuera de alcance

- Instalar `eslint`, `@typescript-eslint/utils` o `eslint-plugin-drizzle`.
- Otras reglas de lint o cambios a la configuración fuera de las dos reglas.

### Archivos esperados

- La regla y sus pruebas (ubicación a proponer en el plan de la task; no crear carpetas genéricas).
- `.oxlintrc.json` — carga de la regla con `jsPlugins` y sus opciones.
- `apps/api/docs/adr/ADR.md` — enmienda o ADR nuevo.
- `apps/api/AGENTS.md` — §1 y §2.

### Pruebas requeridas

- [ ] `update` sin `where` → error; con `where` → sin error.
- [ ] `delete` sin `where` → error; con `where` → sin error.
- [ ] Ambos casos dentro de `db.batch([...])`.
- [ ] Un nombre de objeto configurado distinto de `db` se detecta.

### Criterios de aceptación

- [ ] `pnpm lint` falla si se agrega un `db.delete(tabla)` sin `where` en `apps/api` (probar con un cambio temporal).
- [ ] `pnpm lint` pasa en `main` sin excepciones nuevas.
- [ ] Sin dependencias nuevas en ningún `package.json` ni en `pnpm-lock.yaml`.

---

## T13 — Invitaciones y gestión de miembros

**Fase:** B3 · **Depende de:** T08, T09, T12, T12b · **ADR:** 007, 013 · **Rama sugerida:** `feat/t13-miembros-invitaciones`

### Objetivo

Un `owner` o `admin` verificado invita por correo a su equipo, asigna sucursales a `staff` y puede cambiar roles o quitar miembros sin romper las reglas de ADR-007.

### Alcance

- Tabla `invitations (id, organization_id, email, role, branch_ids text (JSON), token_hash, invited_by_member_id, expires_at, accepted_at, revoked_at, created_at)` y migración. Vigencia 7 días, un solo uso.
- Plantilla de correo `invitation` (ya existe el tipo en T08): enlace `${WEB_ORIGIN}/invitacion?token=…`.
- Rutas privadas (todas con `requirePermission('members:manage')` salvo la lista):
  - `GET /members` (`organization:read`) → miembros con rol, sucursales y correo enmascarado para `staff` que consulta;
  - `POST /invitations` + `requireVerifiedEmail()` + cuota 20 por día por organización;
  - `GET /invitations` y `DELETE /invitations/:invitationId` (revocar);
  - `PATCH /members/:memberId` → `{ role?, branchIds? }`, con `canManageMember`;
  - `DELETE /members/:memberId` → `status = 'removed'` y borra sus `member_branches`, con `canManageMember`.
- Rutas públicas:
  - `GET /v1/public/invitations/:token` → `{ orgName, role, emailMasked, expired }`;
  - `POST /v1/public/invitations/:token/accept`:
    - con sesión y mismo correo → crea membresía;
    - con sesión y otro correo → `CONFLICT` ("Esta invitación es para otro correo.");
    - sin sesión y correo sin cuenta → body `{ name, password }` + Turnstile en header `x-turnstile-token`; crea usuario con `auth.api.signUpEmail`, lo marca verificado (el enlace probó el correo), crea membresía y devuelve la sesión;
    - sin sesión y correo con cuenta → `AUTH_REQUIRED` ("Entra con tu cuenta para aceptar la invitación.").
- Todo en un `db.batch` por operación; el token se marca usado en el mismo batch que la membresía.

### Fuera de alcance

- Transferir la propiedad de la organización.
- Pantalla `/invitacion` en web (requiere agregarse a `DESIGN.md §7`).
- Límite de miembros por plan (se aplica en T14).

### Endpoints

| Método | Ruta                                        | Guardas                             | Entrada                       | Salida                 |
| ------ | ------------------------------------------- | ----------------------------------- | ----------------------------- | ---------------------- |
| GET    | `/v1/orgs/:orgId/members`                   | `organization:read`                 | cursor                        | `MemberDto[]`          |
| POST   | `/v1/orgs/:orgId/invitations`               | `members:manage`, verificado, cuota | `{ email, role, branchIds? }` | `InvitationDto`        |
| GET    | `/v1/orgs/:orgId/invitations`               | `members:manage`                    | —                             | `InvitationDto[]`      |
| DELETE | `/v1/orgs/:orgId/invitations/:invitationId` | `members:manage`                    | —                             | 204                    |
| PATCH  | `/v1/orgs/:orgId/members/:memberId`         | `members:manage` + política         | `{ role?, branchIds? }`       | `MemberDto`            |
| DELETE | `/v1/orgs/:orgId/members/:memberId`         | `members:manage` + política         | —                             | 204                    |
| GET    | `/v1/public/invitations/:token`             | rate limit público                  | —                             | `InvitationPreviewDto` |
| POST   | `/v1/public/invitations/:token/accept`      | Turnstile si no hay sesión          | `{ name?, password? }`        | `{ orgId }` + sesión   |

### Pruebas requeridas

- [ ] `admin` invita `staff` → ok; `admin` invita `admin` u `owner` → 403.
- [ ] Usuario sin verificar no puede invitar.
- [ ] Token aceptado dos veces → la segunda falla; token vencido o revocado → error claro.
- [ ] Aceptar sin cuenta crea usuario verificado y membresía en una sola operación.
- [ ] `branchIds` de otra organización → `VALIDATION_FAILED`.
- [ ] Quitar al último `owner` → `BUSINESS_RULE`.
- [ ] Aislamiento: todas las rutas privadas nuevas con el helper de T12.

### Criterios de aceptación

- [ ] En la base solo existe el hash del token.
- [ ] El correo de invitación sale por la cola, no en línea.

---

## T14 — Planes, suscripciones y límites

**Fase:** B3 · **Depende de:** T12 · **ADR:** 007 · **Rama sugerida:** `feat/t14-planes-limites`

> Límites del piloto aprobados el 2026-11-14: `free` 1 sucursal / 50 productos / 3 miembros activos (incluido el dueño); `pro` 5 / 1000 / 20.

### Objetivo

Cada organización tiene un plan con límites que la API hace cumplir, y su estado de suscripción puede suspender la operación pública.

### Alcance

- Tablas y migración:
  - `plans (id text pk, name, max_branches, max_products, max_members, active)`; la migración siembra `free` (1 sucursal, 50 productos, 3 miembros) y `pro` (5, 1000, 20);
  - `subscriptions (id, organization_id unique, plan_id, status check in ('trialing','active','past_due','suspended'), current_period_end, created_at, updated_at)`.
- `requireMembership` agrega `plan: { id, status, limits }` a `TenantContext` (un join, sin consulta extra).
- `modules/subscriptions/limits.ts`: `assertWithinLimit(deps, 'branches' | 'products' | 'members')` cuenta filas activas y lanza `PLAN_LIMIT_REACHED` con mensaje accionable ("Tu plan permite 1 sucursal. Cambia de plan para agregar más.").
- Aplicar el límite de miembros en `POST /invitations` (T13) y al aceptar.
- Política `canOperate(tenant)`: con `status = 'suspended'` se permiten lecturas y se bloquean escrituras privadas (`FORBIDDEN` con mensaje) — se aplica en un middleware para métodos que no son `GET`.
- `GET /v1/orgs/:orgId/subscription` (`subscription:read`) → plan, estado, límites y uso actual.
- `docs/runbooks/cambiar-plan.md`: cómo cambia un humano el plan o el estado con `wrangler d1 execute` (sin ejecutarlo).

### Fuera de alcance

- Cobro automático, pasarelas de pago y UI de facturación.
- Límites de sucursales y productos aplicados en sus endpoints (se usan en T15 y T16).

### Pruebas requeridas

- [ ] `assertWithinLimit` permite hasta el límite y falla en el siguiente.
- [ ] Organización suspendida: `GET` ok, `POST/PATCH/DELETE` privados → 403.
- [ ] Invitar por encima de `max_members` → `PLAN_LIMIT_REACHED` (402).
- [ ] `GET /subscription` solo para `owner`.

### Criterios de aceptación

- [ ] Los límites se leen de la tabla `plans`, no de constantes en código.

---

## T14b — Capacidades del plan para la marca del menú

**Fase:** B3 · **Depende de:** T14 · **ADR:** 007 · **Rama sugerida:** `feat/t14b-capacidades-plan` · **Bloquea:** T18

> Solo las capacidades que usa T18. Cuotas de zonas, historial ampliado, consulta de auditoría y analíticas se quedan para Release 2.

### Objetivo

El plan dice, además de sus límites numéricos, si la organización puede personalizar la marca de su menú y quitar el sello de MenusMax, y los servicios lo pueden preguntar igual que un límite.

### Alcance

- Migración (_expand_): columnas `custom_theme` y `remove_branding` en `plans` (`integer` booleano, `not null default false`); la migración las pone en `true` para `pro`.
- `TenantContext.plan` agrega `features: { customTheme, removeBranding }`, leídas en el mismo join de `requireMembership` (sin consulta extra).
- `modules/subscriptions/limits.ts`: `assertFeature(deps, 'customTheme' | 'removeBranding')` → `PLAN_LIMIT_REACHED` con mensaje accionable ("La personalización de marca está disponible en Pro. Cambia de plan para usarla.").
- `SubscriptionDto` agrega `features` (cambio aditivo, compatible con web).
- Actualizar `docs/runbooks/cambiar-plan.md` con las dos columnas.

### Fuera de alcance

- Aplicar las capacidades en el tema y el menú público (T18).
- Cualquier otra capacidad o cuota por plan (Release 2).

### Pruebas requeridas

- [ ] `free` → ambas en `false`; `pro` → ambas en `true`, leídas de la tabla (un plan de prueba con valores distintos lo confirma).
- [ ] `assertFeature` permite con la capacidad y lanza 402 sin ella.
- [ ] `GET /subscription` incluye `features` y sigue validando contra su esquema.

### Criterios de aceptación

- [ ] Las capacidades se leen de `plans`, no de constantes en código.
