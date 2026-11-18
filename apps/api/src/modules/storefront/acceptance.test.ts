import { describe, expect, it } from "vitest";
import { acceptingOrders, type AcceptanceBranch, type AcceptanceOrg } from "./acceptance";

const timezone = "America/Mexico_City";
// Lunes 2026-11-16 a las 13:00 en Ciudad de México (UTC-6).
const mondayNoon = new Date("2026-11-16T19:00:00Z");
const open: AcceptanceBranch = {
  timezone,
  hours: [{ weekday: 1, opensAt: "09:00", closesAt: "18:00" }],
};
const closed: AcceptanceBranch = { timezone, hours: [] };
const verified: AcceptanceOrg = { hasVerifiedOwner: true, subscriptionStatus: "active" };

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
      { hasVerifiedOwner: false, subscriptionStatus: "suspended" },
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
