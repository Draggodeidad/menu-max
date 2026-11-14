import { MEMBER_ROLES, type MemberRole } from "@menu-max/contracts";
import { describe, expect, it } from "vitest";
import { hasPermission, PERMISSIONS, type Permission } from "./permissions";

// Matriz de ADR-007 escrita a mano (no derivada de ROLE_PERMISSIONS) para que un cambio en la
// tabla de permisos rompa esta prueba. "Solo sus sucursales" y "solo staff" se resuelven en las
// políticas; aquí el rol sí tiene el permiso.
const EXPECTED: Record<Permission, Record<MemberRole, boolean>> = {
  "organization:read": { owner: true, admin: true, staff: true },
  "catalog:read": { owner: true, admin: true, staff: true },
  "settings:read": { owner: true, admin: true, staff: true },
  "orders:read": { owner: true, admin: true, staff: true },
  "orders:transition": { owner: true, admin: true, staff: true },
  "orders:cancel": { owner: true, admin: true, staff: false },
  "catalog:write": { owner: true, admin: true, staff: false },
  "catalog:availability": { owner: true, admin: true, staff: true },
  "storefront:publish": { owner: true, admin: true, staff: false },
  "settings:write": { owner: true, admin: true, staff: false },
  "branches:manage": { owner: true, admin: true, staff: false },
  "members:manage": { owner: true, admin: true, staff: false },
  "subscription:read": { owner: true, admin: false, staff: false },
  "organization:delete": { owner: true, admin: false, staff: false },
};

describe("hasPermission", () => {
  it("la matriz esperada cubre todos los permisos declarados", () => {
    expect(new Set(Object.keys(EXPECTED))).toEqual(new Set(PERMISSIONS));
  });

  const cases = PERMISSIONS.flatMap((permission) =>
    MEMBER_ROLES.map((role) => [role, permission, EXPECTED[permission][role]] as const),
  );

  it.each(cases)("%s × %s → %s", (role, permission, expected) => {
    expect(hasPermission(role, permission)).toBe(expected);
  });
});
