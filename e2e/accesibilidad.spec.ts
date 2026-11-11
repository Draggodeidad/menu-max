import { expect, test } from "./fixtures";
import { abrirPedido, ir } from "./helpers";
import { AxeBuilder } from "@axe-core/playwright";

for (const [nombre, ruta] of [
  ["inicio", "/"],
  ["crear", "/crear"],
  ["entrar", "/entrar"],
  ["panel", "/app"],
  ["catálogo", "/app/catalogo"],
  ["ajustes", "/app/ajustes"],
  ["menú público", "/m/tacos-el-guero"],
  ["seguimiento", "/pedido/prueba-1234"],
] as const) {
  test(`accesibilidad automática: ${nombre}`, async ({ page }) => {
    test.fixme(nombre === "catálogo", "H10: lista de definiciones mal estructurada");
    await ir(page, ruta);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  });
}

test("el acceso se puede recorrer con teclado y tiene foco visible", async ({ page }) => {
  await ir(page, "/entrar");
  const correo = page.getByLabel("Correo electrónico");
  const estilos = () =>
    correo.evaluate((el) => {
      const css = getComputedStyle(el);
      return [css.outlineStyle, css.outlineWidth, css.boxShadow, css.borderColor].join("|");
    });
  const antes = await estilos();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "MenusMax" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(correo).toBeFocused();
  await expect.poll(estilos).not.toBe(antes);
});

test("accesibilidad automática: checkout con productos", async ({ page }) => {
  await abrirPedido(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target),
    })),
  ).toEqual([]);
});

// H10: el checkout no expone un landmark principal.
test.fixme("checkout tiene un landmark principal", async ({ page }) => {
  await abrirPedido(page);
  await expect(page.getByRole("main")).toHaveCount(1);
});
