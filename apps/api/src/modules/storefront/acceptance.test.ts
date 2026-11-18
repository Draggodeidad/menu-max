import { describe, expect, it } from "vitest";
import {
  acceptingOrders,
  graceExpired,
  type AcceptanceBranch,
  type AcceptanceOrg,
} from "./acceptance";

const timezone = "America/Mexico_City";
// Lunes 2026-11-16 a las 13:00 en Ciudad de México (UTC-6).
const mondayNoon = new Date("2026-11-16T19:00:00Z");
const open: AcceptanceBranch = {
  timezone,
  hours: [{ weekday: 1, opensAt: "09:00", closesAt: "18:00" }],
};
const closed: AcceptanceBranch = { timezone, hours: [] };
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(mondayNoon.getTime() - days * DAY_MS);
const verified: AcceptanceOrg = {
  hasVerifiedOwner: true,
  subscriptionStatus: "active",
  createdAt: daysAgo(1),
};

/** Organización sin dueño verificado, dada de alta hace `days` días. */
function unverified(days: number): AcceptanceOrg {
  return { ...verified, hasVerifiedOwner: false, createdAt: daysAgo(days) };
}

describe("acceptingOrders", () => {
  it.each([
    ["publicado, verificado, activo y abierto", "published", verified, open, true, null],
    ["en prueba", "published", { ...verified, subscriptionStatus: "trialing" }, open, true, null],
    [
      "con pago vencido",
      "published",
      { ...verified, subscriptionStatus: "past_due" },
      open,
      true,
      null,
    ],
    ["borrador", "draft", verified, open, false, "unpublished"],
    [
      "dueño sin verificar",
      "published",
      { ...verified, hasVerifiedOwner: false },
      open,
      false,
      "unverified",
    ],
    [
      "suscripción suspendida",
      "published",
      { ...verified, subscriptionStatus: "suspended" },
      open,
      false,
      "suspended",
    ],
    ["fuera de horario", "published", verified, closed, false, "closed"],
    [
      "suspendida y sin verificar: gana suspended",
      "published",
      { ...verified, hasVerifiedOwner: false, subscriptionStatus: "suspended" },
      closed,
      false,
      "suspended",
    ],
    [
      "sin verificar y cerrada: gana unverified",
      "published",
      { ...verified, hasVerifiedOwner: false },
      closed,
      false,
      "unverified",
    ],
  ] as const)("%s", (_, status, org, branch, accepting, reason) => {
    expect(acceptingOrders({ status }, org, branch, mondayNoon)).toEqual({
      acceptingOrders: accepting,
      reason,
    });
  });

  describe("gracia de ADR-008 (21 días desde el alta)", () => {
    it.each([
      [20, "unverified"],
      [21, "inactive"],
      [90, "inactive"],
    ] as const)("sin dueño verificado a los %i días → %s", (days, reason) => {
      expect(
        acceptingOrders({ status: "published" }, unverified(days), open, mondayNoon).reason,
      ).toBe(reason);
    });

    it("un dueño verificado nunca deja el menú inactivo, aunque la organización sea vieja", () => {
      const old = { ...verified, createdAt: daysAgo(400) };
      expect(acceptingOrders({ status: "published" }, old, open, mondayNoon).acceptingOrders).toBe(
        true,
      );
    });

    it("suspended gana a inactive, e inactive gana a closed", () => {
      const suspended = { ...unverified(30), subscriptionStatus: "suspended" as const };
      expect(acceptingOrders({ status: "published" }, suspended, open, mondayNoon).reason).toBe(
        "suspended",
      );
      expect(
        acceptingOrders({ status: "published" }, unverified(30), closed, mondayNoon).reason,
      ).toBe("inactive");
    });

    it("graceExpired cuenta 21 días exactos", () => {
      const justBefore = {
        hasVerifiedOwner: false,
        createdAt: new Date(mondayNoon.getTime() - 21 * DAY_MS + 1),
      };
      expect(graceExpired(justBefore, mondayNoon)).toBe(false);
      expect(graceExpired({ ...justBefore, createdAt: daysAgo(21) }, mondayNoon)).toBe(true);
    });
  });

  it("respeta la zona horaria de la sucursal", () => {
    // 13:00 en CDMX = 14:00 en Cancún, fuera de un horario de 09:00 a 14:00.
    const cancun: AcceptanceBranch = {
      timezone: "America/Cancun",
      hours: [{ weekday: 1, opensAt: "09:00", closesAt: "14:00" }],
    };
    expect(acceptingOrders({ status: "published" }, verified, cancun, mondayNoon).reason).toBe(
      "closed",
    );
  });
});
