import type { MemberRole } from "@menu-max/contracts";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { canAccessBranch, canManageMember, type MemberChange } from "./policies";
import { allow, assertAllowed, deny, type PolicyResult } from "./result";

const BRANCH_A = "0190f3a0-0000-7000-8000-00000000000a";
const BRANCH_B = "0190f3a0-0000-7000-8000-00000000000b";

const tenant = (role: MemberRole, branchIds: string[] = []) => ({ role, branchIds });

const toRole = (role: MemberRole): MemberChange => ({ action: "update", role });

function codeOf(result: PolicyResult) {
  return result.allowed ? "ALLOW" : result.code;
}

describe("canAccessBranch", () => {
  it.each([
    ["owner", [], BRANCH_A, "ALLOW"],
    ["admin", [], BRANCH_B, "ALLOW"],
    ["staff", [BRANCH_A], BRANCH_A, "ALLOW"],
    ["staff", [BRANCH_A], BRANCH_B, "NOT_FOUND"],
    ["staff", [], BRANCH_A, "NOT_FOUND"],
  ] as const)("%s con sucursales %j sobre %s → %s", (role, branchIds, branchId, expected) => {
    expect(codeOf(canAccessBranch(tenant(role, [...branchIds]), branchId))).toBe(expected);
  });
});

describe("canManageMember", () => {
  const remove: MemberChange = { action: "remove" };
  const branchesOnly: MemberChange = { action: "update" };

  it.each([
    // staff no gestiona a nadie.
    ["staff", "staff", 1, remove, "FORBIDDEN"],
    ["staff", "staff", 1, branchesOnly, "FORBIDDEN"],
    // admin: solo sobre staff y solo asignando staff.
    ["admin", "staff", 1, remove, "ALLOW"],
    ["admin", "staff", 1, branchesOnly, "ALLOW"],
    ["admin", "staff", 1, toRole("staff"), "ALLOW"],
    ["admin", "staff", 1, toRole("admin"), "FORBIDDEN"],
    ["admin", "staff", 1, toRole("owner"), "FORBIDDEN"],
    ["admin", "admin", 1, remove, "FORBIDDEN"],
    ["admin", "admin", 1, toRole("staff"), "FORBIDDEN"],
    ["admin", "owner", 2, remove, "FORBIDDEN"],
    ["admin", "owner", 2, toRole("staff"), "FORBIDDEN"],
    // owner: gestiona a cualquiera, pero no deja a la organización sin dueño.
    ["owner", "staff", 1, toRole("admin"), "ALLOW"],
    ["owner", "admin", 1, toRole("owner"), "ALLOW"],
    ["owner", "admin", 1, remove, "ALLOW"],
    ["owner", "owner", 2, remove, "ALLOW"],
    ["owner", "owner", 2, toRole("admin"), "ALLOW"],
    ["owner", "owner", 1, remove, "BUSINESS_RULE"],
    ["owner", "owner", 1, toRole("admin"), "BUSINESS_RULE"],
    ["owner", "owner", 1, toRole("staff"), "BUSINESS_RULE"],
    ["owner", "owner", 1, toRole("owner"), "ALLOW"],
    ["owner", "owner", 1, branchesOnly, "ALLOW"],
  ] as const)(
    "%s sobre %s (owners activos: %i) con %j → %s",
    (actor, targetRole, activeOwnerCount, change, expected) => {
      const result = canManageMember(tenant(actor), { role: targetRole, activeOwnerCount }, change);
      expect(codeOf(result)).toBe(expected);
    },
  );

  it("explica en español por qué no se puede quitar al último dueño", () => {
    const result = canManageMember(tenant("owner"), { role: "owner", activeOwnerCount: 1 }, remove);
    expect(() => assertAllowed(result)).toThrow(
      "La organización necesita al menos un dueño. Asigna otro dueño antes de continuar.",
    );
  });
});

describe("assertAllowed", () => {
  it("no lanza con allow()", () => {
    expect(() => assertAllowed(allow())).not.toThrow();
  });

  it("lanza AppError con el código y el mensaje del catálogo si no se indica otro", () => {
    let error: unknown;
    try {
      assertAllowed(deny("FORBIDDEN"));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("FORBIDDEN");
    expect((error as AppError).message).toBe(
      "Tu cuenta no tiene permiso para realizar esta acción.",
    );
  });

  it("usa el mensaje propio de la política", () => {
    expect(() => assertAllowed(deny("BUSINESS_RULE", "Mensaje propio."))).toThrow(
      "Mensaje propio.",
    );
  });
});
