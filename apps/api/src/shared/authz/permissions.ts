import type { MemberRole } from "@menu-max/contracts";

/**
 * Permisos del MVP (ADR-007). Única fuente de verdad de la relación rol → permiso.
 * Permiso nuevo = agregarlo aquí y a la prueba de matriz en el mismo PR.
 */
export const PERMISSIONS = [
  "organization:read",
  "organization:delete",
  "orders:read",
  "orders:transition",
  "orders:cancel",
  "catalog:read",
  "catalog:write",
  "catalog:availability",
  "storefront:publish",
  "settings:read",
  "settings:write",
  "branches:manage",
  "members:manage",
  "subscription:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Matriz RBAC de ADR-007. Las restricciones por atributo ("staff solo sus sucursales",
 * "admin solo gestiona staff") no viven aquí: las aplican las políticas de `policies.ts`.
 */
export const ROLE_PERMISSIONS = {
  owner: [...PERMISSIONS],
  admin: [
    "organization:read",
    "orders:read",
    "orders:transition",
    "orders:cancel",
    "catalog:read",
    "catalog:write",
    "catalog:availability",
    "storefront:publish",
    "settings:read",
    "settings:write",
    "branches:manage",
    "members:manage",
  ],
  staff: [
    "organization:read",
    "orders:read",
    "orders:transition",
    "catalog:read",
    "catalog:availability",
    "settings:read",
  ],
} as const satisfies Record<MemberRole, readonly Permission[]>;

export function hasPermission(role: MemberRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] as readonly Permission[]).includes(permission);
}
