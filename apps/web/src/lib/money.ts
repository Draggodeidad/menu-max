const mxn = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

/** Formatea centavos como moneda MXN. El dinero siempre viaja en centavos. */
export function formatMoney(cents: number): string {
  return mxn.format(cents / 100);
}

/**
 * Convierte lo que escribe el usuario ("22", "22.5", "22,50", "$22.00") a centavos.
 * Devuelve `null` si no es un importe válido. Solo es ayuda de entrada: el servidor decide.
 */
export function parseMoneyToCents(input: string, { allowZero = false } = {}): number | null {
  const limpio = input.replace(/[\s$]/g, "").replace(",", ".");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(limpio)) return null;
  const cents = Math.round(Number(limpio) * 100);
  return cents > 0 || (allowZero && cents === 0) ? cents : null;
}

/** Centavos como número para un campo de texto: 2200 → "22.00" (sin símbolo de moneda). */
export function formatMoneyInput(cents: number): string {
  return (cents / 100).toFixed(2);
}
