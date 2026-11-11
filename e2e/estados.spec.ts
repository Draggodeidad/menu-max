import { expect, test } from "./fixtures";
import { abrirPedido, ir } from "./helpers";

test("menú muestra vacío y negocio cerrado", async ({ page }) => {
  await ir(page, "/m/tacos-el-guero?vacio=1");
  await expect(
    page.getByRole("heading", { name: "Aún no hay productos en este menú" }),
  ).toBeVisible();
  await ir(page, "/m/tacos-el-guero?abierto=false");
  await expect(page.getByText("Cerrado · abre a las 09:00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Agregar Suadero confitado" })).toBeDisabled();
});

test("checkout vacío ofrece volver al menú", async ({ page }) => {
  await ir(page, "/m/tacos-el-guero/pedido");
  await expect(page.getByRole("heading", { name: "Tu pedido está vacío" })).toBeVisible();
  await page.getByRole("link", { name: "Ver menú" }).click();
  await expect(page).toHaveURL(/\/m\/tacos-el-guero$/);
});

test("checkout informa producto agotado simulado", async ({ page }) => {
  await abrirPedido(page, "?error=1");
  await page.getByLabel("Nombre completo").fill("Ana Prueba");
  await page.getByLabel("Teléfono (WhatsApp)").fill("5512345678");
  await page.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(page.getByRole("alert")).toContainText("Este producto ya no está disponible");
});

for (const [ruta, mensaje] of [
  ["/app?vacio=1", "Aún no hay pedidos"],
  ["/app?error=1", "No pudimos cargar los pedidos"],
  ["/app/catalogo?vacio=1", "Aún no hay productos"],
  ["/app/catalogo?error=1", "No pudimos cargar tu menú"],
  ["/app/ajustes?error=1", "No pudimos cargar tus ajustes"],
] as const) {
  test(`muestra ${mensaje}`, async ({ page }) => {
    await ir(page, ruta);
    await expect(page.getByRole("heading", { name: mensaje })).toBeVisible();
  });
}

test("muestra indicador de carga al navegar a pedidos lentos", async ({ page }) => {
  await ir(page, "/app/catalogo");
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "/app?lento=1";
    a.textContent = "Ir a pedidos lentos";
    document.body.append(a);
    setTimeout(() => a.click(), 0);
  });
  await expect(page.getByRole("status").filter({ hasText: "Cargando pedidos" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
});

test("seguimiento muestra rechazo, retraso y detalle vacío", async ({ page }) => {
  await ir(page, "/pedido/prueba?estado=rejected");
  await expect(page.getByRole("heading", { name: "Pedido rechazado" })).toBeVisible();
  await expect(page.getByText("El negocio no pudo aceptar tu pedido")).toBeVisible();
  await ir(page, "/pedido/prueba?retraso=1&vacio=1");
  await expect(page.getByText(/Tu pedido tarda más de lo normal/)).toBeVisible();
  await expect(page.getByText(/No hay productos en el detalle/)).toBeVisible();
});

// H13: la lectura del menú no implementa el estado de error.
test.fixme("el menú público ofrece reintento ante un error de carga simulado", async ({ page }) => {
  await ir(page, "/m/tacos-el-guero?error=1");
  await expect(page.getByRole("alert")).toContainText(/no (pudimos|se pudo) cargar/i);
  await expect(page.getByRole("button", { name: /reintentar/i })).toBeVisible();
});

test("muestra carga al abrir un menú público lento", async ({ page }) => {
  await ir(page, "/m/tacos-el-guero/pedido");
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/m/tacos-el-guero?lento=1";
    document.body.append(link);
    setTimeout(() => link.click(), 0);
  });
  await expect(page.getByRole("status", { name: "Cargando" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "Tacos El Güero" })).toBeVisible();
});
