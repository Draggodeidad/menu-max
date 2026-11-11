const mxn = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
});

/** Formatea centavos como moneda MXN. El dinero siempre viaja en centavos. */
export function formatMoney(cents: number): string {
  return mxn.format(cents / 100);
}
