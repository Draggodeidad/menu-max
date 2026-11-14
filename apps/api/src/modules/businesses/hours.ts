// Horarios de sucursal (T15): funciones puras, sin I/O. Los rangos están en la hora local de la
// sucursal y nunca cruzan la medianoche; `24:00` marca el fin del día.
import type { HoursRangeDto, HoursRangeInput } from "@menu-max/contracts";

export type HoursRange = HoursRangeDto;

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;

/** `HH:MM` → minutos desde las 00:00 (`24:00` → 1440). */
export function toMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export const OVERLAPPING_HOURS = "Hay horarios que se enciman el mismo día. Ajusta los rangos.";

/**
 * Parte los rangos que cruzan la medianoche (`22:00 → 02:00` = `22:00 → 24:00` ese día y
 * `00:00 → 02:00` el siguiente) y los ordena por día y apertura. Devuelve `null` si dos rangos
 * del mismo día se enciman; dos rangos que se tocan (`… → 15:00` y `15:00 → …`) son válidos.
 */
export function normalizeWeek(ranges: readonly HoursRangeInput[]): HoursRange[] | null {
  const split: HoursRange[] = [];
  for (const range of ranges) {
    if (toMinutes(range.opensAt) < toMinutes(range.closesAt)) {
      split.push({ ...range });
      continue;
    }
    split.push({ weekday: range.weekday, opensAt: range.opensAt, closesAt: "24:00" });
    if (range.closesAt !== "00:00") {
      split.push({ weekday: (range.weekday + 1) % 7, opensAt: "00:00", closesAt: range.closesAt });
    }
  }
  split.sort((a, b) => a.weekday - b.weekday || toMinutes(a.opensAt) - toMinutes(b.opensAt));
  for (let i = 1; i < split.length; i++) {
    const previous = split[i - 1];
    const current = split[i];
    if (
      previous &&
      current &&
      previous.weekday === current.weekday &&
      toMinutes(current.opensAt) < toMinutes(previous.closesAt)
    ) {
      return null;
    }
  }
  return split;
}

type LocalDateTime = { year: number; month: number; day: number; weekday: number; minutes: number };

/** Fecha, día de la semana y minuto del día de `instant` en la zona `timeZone`. */
function localDateTime(instant: Date, timeZone: string): LocalDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return {
    year,
    month,
    day,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minutes: part("hour") * 60 + part("minute"),
  };
}

/** Diferencia en ms entre la hora local de `timeZone` y UTC en el instante `utcMs`. */
function offsetMs(utcMs: number, timeZone: string): number {
  const local = localDateTime(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day) + local.minutes * MS_PER_MINUTE;
  return asUtc - Math.floor(utcMs / MS_PER_MINUTE) * MS_PER_MINUTE;
}

/** Instante UTC de una hora local; corrige una vez por si el desfase cambia (horario de verano). */
function fromLocal(year: number, month: number, day: number, minutes: number, timeZone: string) {
  const wallMs = Date.UTC(year, month - 1, day) + minutes * MS_PER_MINUTE;
  let utcMs = wallMs - offsetMs(wallMs, timeZone);
  utcMs = wallMs - offsetMs(utcMs, timeZone);
  return new Date(utcMs);
}

/** ¿La sucursal atiende en `now`? Sin rangos, nunca está abierta. */
export function isOpen(hours: readonly HoursRange[], timeZone: string, now: Date): boolean {
  const local = localDateTime(now, timeZone);
  return hours.some(
    (range) =>
      range.weekday === local.weekday &&
      toMinutes(range.opensAt) <= local.minutes &&
      local.minutes < toMinutes(range.closesAt),
  );
}

/**
 * Siguiente apertura después de `now`, o `null` si la sucursal está abierta o no tiene horario.
 * Busca hasta 7 días adelante: con al menos un rango, siempre hay una apertura en ese plazo.
 */
export function nextOpening(
  hours: readonly HoursRange[],
  timeZone: string,
  now: Date,
): Date | null {
  if (hours.length === 0 || isOpen(hours, timeZone, now)) return null;
  const today = localDateTime(now, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    const weekday = date.getUTCDay();
    const first = Math.min(
      ...hours
        .filter((range) => range.weekday === weekday)
        .map((range) => toMinutes(range.opensAt))
        .filter((start) => offset > 0 || start > today.minutes),
    );
    if (first < MINUTES_PER_DAY) {
      return fromLocal(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        first,
        timeZone,
      );
    }
  }
  return null;
}
