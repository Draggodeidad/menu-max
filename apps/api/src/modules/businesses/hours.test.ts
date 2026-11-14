import { describe, expect, it } from "vitest";
import { isOpen, nextOpening, normalizeWeek, type HoursRange } from "./hours";

const MX = "America/Mexico_City"; // UTC-6 todo el año (sin horario de verano desde 2022).
const TIJUANA = "America/Tijuana"; // UTC-8, o UTC-7 con horario de verano.

/** Instante UTC a partir de una hora de Ciudad de México (UTC-6). */
function mx(isoLocal: string) {
  return new Date(`${isoLocal}-06:00`);
}

// 2026-11-16 es lunes (weekday 1).
const weekdays = (from: number, to: number, opensAt: string, closesAt: string): HoursRange[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ weekday: from + i, opensAt, closesAt }));

describe("normalizeWeek", () => {
  it("ordena por día y apertura sin tocar los rangos normales", () => {
    expect(
      normalizeWeek([
        { weekday: 2, opensAt: "17:00", closesAt: "22:00" },
        { weekday: 2, opensAt: "09:00", closesAt: "13:00" },
        { weekday: 1, opensAt: "09:00", closesAt: "18:00" },
      ]),
    ).toEqual([
      { weekday: 1, opensAt: "09:00", closesAt: "18:00" },
      { weekday: 2, opensAt: "09:00", closesAt: "13:00" },
      { weekday: 2, opensAt: "17:00", closesAt: "22:00" },
    ]);
  });

  it("parte en dos un rango que cruza la medianoche, incluso de sábado a domingo", () => {
    expect(normalizeWeek([{ weekday: 6, opensAt: "20:00", closesAt: "02:30" }])).toEqual([
      { weekday: 0, opensAt: "00:00", closesAt: "02:30" },
      { weekday: 6, opensAt: "20:00", closesAt: "24:00" },
    ]);
  });

  it("un cierre a las 00:00 equivale a 24:00 del mismo día", () => {
    expect(normalizeWeek([{ weekday: 3, opensAt: "18:00", closesAt: "00:00" }])).toEqual([
      { weekday: 3, opensAt: "18:00", closesAt: "24:00" },
    ]);
  });

  it("acepta rangos que se tocan y rechaza los que se enciman", () => {
    expect(
      normalizeWeek([
        { weekday: 1, opensAt: "09:00", closesAt: "15:00" },
        { weekday: 1, opensAt: "15:00", closesAt: "20:00" },
      ]),
    ).toHaveLength(2);
    expect(
      normalizeWeek([
        { weekday: 1, opensAt: "09:00", closesAt: "15:00" },
        { weekday: 1, opensAt: "14:00", closesAt: "20:00" },
      ]),
    ).toBeNull();
  });

  it("rechaza un rango que cruza la medianoche y se encima con el día siguiente", () => {
    expect(
      normalizeWeek([
        { weekday: 5, opensAt: "22:00", closesAt: "03:00" },
        { weekday: 6, opensAt: "02:00", closesAt: "10:00" },
      ]),
    ).toBeNull();
  });
});

describe("isOpen", () => {
  const hours = weekdays(1, 5, "09:00", "18:00");

  it("rango normal: abierto dentro, cerrado en el límite de cierre y antes de abrir", () => {
    expect(isOpen(hours, MX, mx("2026-11-16T09:00:00"))).toBe(true);
    expect(isOpen(hours, MX, mx("2026-11-16T17:59:00"))).toBe(true);
    expect(isOpen(hours, MX, mx("2026-11-16T18:00:00"))).toBe(false);
    expect(isOpen(hours, MX, mx("2026-11-16T08:59:00"))).toBe(false);
  });

  it("usa la zona de la sucursal, no UTC", () => {
    // 2026-11-17T02:00Z es lunes 20:00 en CDMX (cerrado), martes en UTC.
    expect(isOpen(hours, MX, new Date("2026-11-17T02:00:00Z"))).toBe(false);
    // 2026-11-16T15:00Z es lunes 09:00 en CDMX y 07:00 en Tijuana.
    expect(isOpen(hours, MX, new Date("2026-11-16T15:00:00Z"))).toBe(true);
    expect(isOpen(hours, TIJUANA, new Date("2026-11-16T15:00:00Z"))).toBe(false);
  });

  it("día cerrado: sin rangos ese día", () => {
    expect(isOpen(hours, MX, mx("2026-11-15T12:00:00"))).toBe(false); // domingo
    expect(isOpen([], MX, mx("2026-11-16T12:00:00"))).toBe(false);
  });

  it("cruce de medianoche: abierto antes y después de las 00:00", () => {
    const night = normalizeWeek([{ weekday: 5, opensAt: "20:00", closesAt: "02:00" }]) ?? [];
    expect(isOpen(night, MX, mx("2026-11-20T23:30:00"))).toBe(true); // viernes
    expect(isOpen(night, MX, mx("2026-11-21T01:59:00"))).toBe(true); // sábado
    expect(isOpen(night, MX, mx("2026-11-21T02:00:00"))).toBe(false);
  });

  it("varios rangos: cerrado entre ellos", () => {
    const split: HoursRange[] = [
      { weekday: 1, opensAt: "09:00", closesAt: "13:00" },
      { weekday: 1, opensAt: "17:00", closesAt: "22:00" },
    ];
    expect(isOpen(split, MX, mx("2026-11-16T12:00:00"))).toBe(true);
    expect(isOpen(split, MX, mx("2026-11-16T15:00:00"))).toBe(false);
    expect(isOpen(split, MX, mx("2026-11-16T18:00:00"))).toBe(true);
  });
});

describe("nextOpening", () => {
  it("es null si está abierta o si no tiene horario", () => {
    expect(nextOpening(weekdays(1, 5, "09:00", "18:00"), MX, mx("2026-11-16T10:00:00"))).toBeNull();
    expect(nextOpening([], MX, mx("2026-11-16T10:00:00"))).toBeNull();
  });

  it("rango normal: más tarde el mismo día", () => {
    expect(nextOpening(weekdays(1, 5, "09:00", "18:00"), MX, mx("2026-11-16T07:15:00"))).toEqual(
      mx("2026-11-16T09:00:00"),
    );
  });

  it("varios rangos: el siguiente del mismo día", () => {
    const split: HoursRange[] = [
      { weekday: 1, opensAt: "09:00", closesAt: "13:00" },
      { weekday: 1, opensAt: "17:00", closesAt: "22:00" },
    ];
    expect(nextOpening(split, MX, mx("2026-11-16T14:00:00"))).toEqual(mx("2026-11-16T17:00:00"));
  });

  it("día cerrado: salta al siguiente día con horario", () => {
    // Viernes 19:00 → lunes 09:00.
    expect(nextOpening(weekdays(1, 5, "09:00", "18:00"), MX, mx("2026-11-20T19:00:00"))).toEqual(
      mx("2026-11-23T09:00:00"),
    );
  });

  it("un solo día por semana: la misma hora una semana después", () => {
    const monday: HoursRange[] = [{ weekday: 1, opensAt: "09:00", closesAt: "10:00" }];
    expect(nextOpening(monday, MX, mx("2026-11-16T11:00:00"))).toEqual(mx("2026-11-23T09:00:00"));
  });

  it("cruce de medianoche: tras cerrar a las 02:00 abre a las 20:00 del viernes siguiente", () => {
    const night = normalizeWeek([{ weekday: 5, opensAt: "20:00", closesAt: "02:00" }]) ?? [];
    expect(nextOpening(night, MX, mx("2026-11-21T03:00:00"))).toEqual(mx("2026-11-27T20:00:00"));
    expect(nextOpening(night, MX, mx("2026-11-20T19:00:00"))).toEqual(mx("2026-11-20T20:00:00"));
  });

  it("respeta el horario de verano de la zona", () => {
    // Tijuana: UTC-7 en verano (julio) y UTC-8 en invierno (diciembre).
    const daily = weekdays(0, 6, "09:00", "18:00");
    expect(nextOpening(daily, TIJUANA, new Date("2026-07-15T14:00:00Z"))).toEqual(
      new Date("2026-07-15T16:00:00Z"),
    );
    expect(nextOpening(daily, TIJUANA, new Date("2026-12-15T15:00:00Z"))).toEqual(
      new Date("2026-12-15T17:00:00Z"),
    );
  });
});
