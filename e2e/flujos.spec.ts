import { expect, test } from "./fixtures";
import { abrirPedido, enviarPedido, ir, menu } from "./helpers";

test("landing lleva el nombre a crear y conserva el borrador", async ({ page }) => {
  await ir(page, "/");
  await page.getByLabel("Nombre de tu negocio").fill("Cocina de Ana");
  await page.getByRole("button", { name: "Crear mi menú" }).click();
  await expect(page).toHaveURL(/\/crear\?nombre=Cocina/);
  await expect(page.getByLabel("Nombre de tu negocio")).toHaveValue("Cocina de Ana");
  await page.getByLabel("Nombre del producto 1").fill("Sopa de tortilla");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("menusmax-borrador")))
    .toContain("Sopa de tortilla");
  await page.reload();
  await expect(page.getByLabel("Nombre del producto 1")).toHaveValue("Sopa de tortilla");
});

test("crear permite publicar el menú y abrirlo desde el QR", async ({ page }) => {
  await ir(page, "/crear?nombre=Cocina%20de%20Ana");
  await page.getByLabel("WhatsApp para recibir pedidos").fill("5512345678");
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Publicar menú" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Publicar menú" })).toBeEnabled();
  await page.getByRole("button", { name: "Publicar menú" }).click();
  await expect(page).toHaveURL(/\/app\/listo$/);
  await page.getByRole("link", { name: "Hacer un pedido de prueba" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cocina de Ana");
});

test("crear valida campos obligatorios antes de publicar", async ({ page }) => {
  await ir(page, "/crear");
  await page.getByRole("button", { name: "Publicar menú" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Publicar menú" })).toBeEnabled();
  await page.getByRole("button", { name: "Publicar menú" }).click();
  await expect(page.getByLabel("Nombre de tu negocio")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("WhatsApp para recibir pedidos")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("login simulado redirige al panel", async ({ page }) => {
  await ir(page, "/entrar");
  await page.getByLabel("Correo electrónico").fill("ana@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("12345678");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { name: "Pedidos", exact: true })).toBeVisible();
});

// H08: falta una guardia de sesión simulada.
test.fixme("el panel exige sesión simulada antes de entrar", async ({ page }) => {
  await ir(page, "/app");
  await expect(page).toHaveURL(/\/entrar$/);
});

test("pedido simulado llega al seguimiento con los datos capturados", async ({ page }) => {
  await enviarPedido(page);
  await expect(page.getByText("Ana Prueba", { exact: true })).toBeVisible();
  await expect(page.getByText("1× Agua de horchata (1 L)")).toBeVisible();
  await expect(page.getByText("$35.00 MXN", { exact: true })).toBeVisible();
  const seguimiento = page.url();
  await ir(page, "/app");
  const pedido = page.getByRole("article").filter({ hasText: "Ana Prueba" });
  await pedido.getByRole("button", { name: "Aceptar", exact: true }).click();
  // Espera a que la action termine; navegar antes cancela la petición y pierde la cookie.
  await expect(pedido.getByRole("button", { name: "Empezar a preparar" })).toBeVisible();
  await ir(page, seguimiento);
  await expect(page.getByRole("heading", { name: "Aceptado", exact: true })).toBeVisible();
});

test("pedido simulado aparece en el panel del negocio", async ({ page }) => {
  await enviarPedido(page);
  await ir(page, "/app");
  const pedido = page.getByRole("article").filter({ hasText: "Ana Prueba" });
  await expect(pedido).toBeVisible();
  await expect(pedido).toContainText("Agua de horchata");
});

// H03: no hay salida a WhatsApp.
test.fixme("el pedido ofrece salida a WhatsApp sin enviar mensajes durante la prueba", async ({
  page,
}) => {
  await enviarPedido(page);
  const enlace = page.getByRole("link", { name: /whatsapp/i });
  await expect(enlace).toHaveAttribute(
    "href",
    /^https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//,
  );
});

test("acepta y avanza un pedido y conserva el cambio al recargar", async ({ page }) => {
  await ir(page, "/app");
  let pedido = page.getByRole("article").filter({ hasText: "#1045" });
  await pedido.getByRole("button", { name: "Aceptar", exact: true }).click();
  await expect(pedido.getByRole("button", { name: "Empezar a preparar" })).toBeVisible();
  await pedido.getByRole("button", { name: "Empezar a preparar" }).click();
  await expect(pedido.getByRole("button", { name: "Marcar listo" })).toBeVisible();
  await page.reload();
  pedido = page.getByRole("article").filter({ hasText: "#1045" });
  await expect(pedido.getByRole("button", { name: "Marcar listo" })).toBeVisible();
});

test("el precio editado en el catálogo se refleja en el menú público", async ({ page }) => {
  await ir(page, "/app/catalogo");
  const precio = page.getByLabel("Precio de Pastor con piña en pesos");
  await precio.fill("32.00");
  await precio.blur();
  await expect(
    page.locator("#producto-pastor").getByText("Guardado", { exact: true }),
  ).toBeVisible();
  await ir(page, menu);
  const producto = page
    .locator("li")
    .filter({ has: page.getByRole("heading", { name: "Pastor con piña" }) });
  await expect(producto).toContainText("$32.00");
});

test("el menú público omite los productos agotados del catálogo", async ({ page }) => {
  await ir(page, menu);
  await expect(page.getByRole("heading", { name: "Gringa de pastor" })).toHaveCount(0);
  await ir(page, "/app/catalogo");
  await expect(page.locator("#producto-gringa")).toBeVisible();
});

// H06: el checkout ignora las modalidades guardadas.
test.fixme("las modalidades guardadas se respetan en el checkout", async ({ page }) => {
  await ir(page, "/app/ajustes");
  await page
    .getByRole("switch", { name: /A domicilio/ })
    .locator("..")
    .click();
  await page.getByRole("button", { name: "Guardar horarios y modalidades" }).click();
  await expect(page.locator("form[action*='servicio']").getByRole("status")).toHaveText("Guardado");
  await abrirPedido(page);
  await expect(page.getByRole("radio", { name: "A domicilio" })).toHaveCount(0);
});

// H07: el menú usa un tema fijo.
test.fixme("el tema guardado se aplica al menú público", async ({ page }) => {
  await ir(page, "/app/ajustes");
  await page.getByLabel("Color primario de acción (botones y destacados)").fill("#123456");
  await page.getByRole("button", { name: /Guardar cambios de tema/i }).click();
  await expect(page.locator("form[action*='tema']").getByRole("status")).toHaveText("Guardado");
  await ir(page, menu);
  const color = await page
    .locator("[style*='--brand:']")
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue("--brand").trim());
  expect(color.toLowerCase()).toBe("#123456");
});

// H04: la action acepta IDs inexistentes.
test.fixme("checkout rechaza un producto inexistente", async ({ page }) => {
  await abrirPedido(page);
  await page.getByLabel("Nombre completo").fill("Ana Prueba");
  await page.getByLabel("Teléfono (WhatsApp)").fill("5512345678");
  await page
    .locator('input[name="id"]')
    .first()
    .evaluate((input: HTMLInputElement) => {
      input.value = "producto-inexistente";
    });
  await page.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(page.getByRole("alert")).toContainText(/producto|disponible/i);
  await expect(page).toHaveURL(/\/m\/tacos-el-guero\/pedido/);
});

test("un pedido de mesa conserva el número y no pide modalidad", async ({ page }) => {
  await ir(page, `${menu}?mesa=4`);
  await page.getByRole("button", { name: "Agregar Agua de horchata (1 L)" }).click();
  await page.getByRole("link", { name: /Ver pedido/ }).click();
  await expect(page).toHaveURL(/\?mesa=4/);
  await expect(page.getByText(/Sucursal Roma Sur · Mesa 4/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /domicilio|recoger/i })).toHaveCount(0);
});

// H11: la confirmación afirma un envío que no ocurre.
test.fixme("la invitación deja claro que el envío es simulado", async ({ page }) => {
  await ir(page, "/app/ajustes");
  const form = page.locator("form[action*='invitar']");
  await form.getByLabel("Correo del colaborador").fill("colaborador@example.com");
  await form.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(form.getByRole("status")).toContainText(/simulad|demostración/i);
});
