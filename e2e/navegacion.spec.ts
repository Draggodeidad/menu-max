import { expect, test } from "./fixtures";
import { ir } from "./helpers";

const rutas = [
  ["/", "Tu menú en línea, con pedidos por WhatsApp."],
  ["/crear", "Arma tu menú digital"],
  ["/entrar", "Entra a tu panel"],
  ["/app", "Pedidos"],
  ["/app/listo", "Tu menú está publicado."],
  ["/app/catalogo", "Menú"],
  ["/app/ajustes", "Ajustes"],
  ["/m/tacos-el-guero", "Tacos El Güero"],
  ["/m/tacos-el-guero/pedido", "Tu pedido"],
  ["/pedido/prueba-1234", "En preparación"],
] as const;

for (const [ruta, titulo] of rutas) {
  test(`carga ${ruta} sin error ni desbordamiento horizontal`, async ({ page }) => {
    const errores: string[] = [];
    page.on("pageerror", (error) => errores.push(error.message));
    const response = await ir(page, ruta);
    expect(response?.status()).toBe(200);
    expect(errores).toEqual([]);
    await expect(page.getByRole("heading", { level: 1, name: titulo, exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
  });
}

test("navega entre pedidos, menú y ajustes desde el panel", async ({ page }) => {
  await ir(page, "/app");
  const nav = page
    .getByRole("navigation", { name: "Navegación del panel" })
    .filter({ visible: true });
  await nav.getByRole("link", { name: "Menú", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/catalogo$/);
  await nav.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/ajustes$/);
  await nav.getByRole("link", { name: "Pedidos", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
});

test("el menú público es legible sin JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  await page.goto("/m/tacos-el-guero");
  await expect(page.getByRole("heading", { name: "Tacos El Güero" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pastor con piña" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Agregar/ })).toHaveCount(0);
  await context.close();
});

test("un negocio desconocido responde 404", async ({ page }) => {
  const response = await page.goto("/m/negocio-que-no-existe");
  expect(response?.status()).toBe(404);
});

test("un token de pedido desconocido responde 404", async ({ page }) => {
  const response = await page.goto("/pedido/token-que-no-existe");
  expect(response?.status()).toBe(404);
});
