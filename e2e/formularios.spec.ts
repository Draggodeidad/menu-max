import { expect, test } from "./fixtures";
import { abrirPedido, ir } from "./helpers";

test("login muestra errores asociados y enfoca el primer campo inválido", async ({ page }) => {
  await ir(page, "/entrar");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  const correo = page.getByLabel("Correo electrónico");
  await expect(page.getByText("Escribe un correo electrónico válido.")).toBeVisible();
  await expect(page.getByText("Escribe tu contraseña.")).toBeVisible();
  await expect(correo).toHaveAttribute("aria-invalid", "true");
  await expect(correo).toHaveAttribute("aria-describedby", "correo-error");
  await expect(correo).toBeFocused();
});

test("checkout valida nombre, teléfono y dirección para domicilio", async ({ page }) => {
  await abrirPedido(page);
  await page.getByText("A domicilio", { exact: true }).click();
  await page.getByLabel("Nombre completo").fill("A");
  await page.getByLabel("Teléfono (WhatsApp)").fill("123");
  await page.getByLabel("Dirección de entrega").fill("abc");
  await page.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(
    page.getByText("Escribe tu nombre para que el negocio sepa a quién entregar."),
  ).toBeVisible();
  await expect(
    page.getByText("Escribe tu teléfono de 10 dígitos para confirmar tu pedido."),
  ).toBeVisible();
  await expect(page.getByText("Escribe calle, número y colonia para el domicilio.")).toBeVisible();
  await expect(page.getByLabel("Nombre completo")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Dirección de entrega")).toBeFocused();
});

test("checkout bloquea campos requeridos vacíos", async ({ page }) => {
  await abrirPedido(page);
  await page.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(page.getByLabel("Nombre completo")).toBeFocused();
  await expect(page.getByLabel("Nombre completo")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Teléfono (WhatsApp)")).toHaveAttribute("required", "");
});

test("rechazar un pedido exige motivo y muestra el error", async ({ page }) => {
  await ir(page, "/app");
  const pedido = page.getByRole("article").filter({ hasText: "#1045" });
  await pedido.getByText("Rechazar pedido").click();
  await pedido.getByRole("button", { name: "Confirmar rechazo" }).click();
  await expect(
    pedido.getByText("Escribe el motivo del rechazo para avisar al cliente."),
  ).toBeVisible();
  await expect(pedido.getByLabel("Motivo del rechazo")).toHaveAttribute("aria-invalid", "true");
});

test("catálogo valida y agrega un producto en una categoría", async ({ page }) => {
  await ir(page, "/app/catalogo");
  await page.getByText("Agregar producto a Tacos").click();
  const seccion = page.locator("#categoria-tacos");
  await seccion.getByRole("button", { name: "Agregar producto", exact: true }).click();
  await expect(seccion.getByText("Escribe un precio mayor a $0. Ejemplo: 22.00")).toBeVisible();
  await seccion.getByLabel("Nombre del producto", { exact: true }).fill("Taco de prueba");
  await seccion.getByLabel("Precio", { exact: true }).fill("38.00");
  await seccion.getByRole("button", { name: "Agregar producto", exact: true }).click();
  await expect(seccion.getByRole("heading", { name: "Taco de prueba" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Taco de prueba" })).toBeVisible();
});

test("ajustes valida que exista al menos una modalidad", async ({ page }) => {
  await ir(page, "/app/ajustes");
  const form = page.locator("form[action*='servicio']");
  await form
    .getByRole("switch", { name: /En mesa/ })
    .locator("..")
    .click();
  await form
    .getByRole("switch", { name: /Recoger en mostrador/ })
    .locator("..")
    .click();
  await form
    .getByRole("switch", { name: /A domicilio/ })
    .locator("..")
    .click();
  await form.getByRole("button", { name: "Guardar horarios y modalidades" }).click();
  await expect(form.getByText("Activa al menos una modalidad para recibir pedidos.")).toBeVisible();
});

test("ajustes valida contraste insuficiente del color", async ({ page }) => {
  await ir(page, "/app/ajustes");
  await page.getByLabel("Color primario de acción (botones y destacados)").fill("#FFFFFF");
  await page.getByRole("button", { name: "Guardar cambios de tema" }).click();
  await expect(page.getByText(/Este color no se lee bien sobre el fondo del menú/)).toBeVisible();
  await expect(page.getByLabel("Color primario de acción (botones y destacados)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("catálogo rechaza una categoría duplicada", async ({ page }) => {
  await ir(page, "/app/catalogo");
  await page.locator("summary").filter({ hasText: "Agregar categoría" }).click();
  const form = page.locator("form[action*='agregarCategoria']");
  await form.getByLabel("Nombre de la categoría").fill("Tacos");
  await form.getByRole("button", { name: "Agregar categoría" }).click();
  await expect(form.getByText("Ya tienes una categoría con ese nombre. Usa otro.")).toBeVisible();
  await expect(form.getByLabel("Nombre de la categoría")).toHaveAttribute("aria-invalid", "true");
});

test("ajustes rechaza una zona con costo negativo", async ({ page }) => {
  await ir(page, "/app/ajustes");
  const form = page.locator("form[action*='zonas']");
  await form
    .getByLabel(/Costo de envío de la zona/)
    .first()
    .fill("-1");
  await form.getByRole("button", { name: "Guardar zonas de entrega" }).click();
  await expect(form.getByText("Escribe un costo entre $0 y $9,999.")).toBeVisible();
  await expect(form.getByLabel(/Costo de envío de la zona/).first()).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("ajustes rechaza una invitación duplicada", async ({ page }) => {
  await ir(page, "/app/ajustes");
  const form = page.locator("form[action*='invitar']");
  await form.getByLabel("Correo del colaborador").fill("juan@tacoselguero.mx");
  await form.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(form.getByText("Ese correo ya tiene acceso al panel.")).toBeVisible();
  await expect(form.getByLabel("Correo del colaborador")).toHaveAttribute("aria-invalid", "true");
});

test("el generador de QR limita el número de mesas", async ({ page }) => {
  await ir(page, "/app/ajustes");
  const mesas = page.getByLabel("Total mesas:");
  await expect(mesas).toHaveAttribute("min", "1");
  await expect(mesas).toHaveAttribute("max", "30");
  await mesas.fill("31");
  await mesas.blur();
  expect(await mesas.evaluate((element: HTMLInputElement) => element.validity.rangeOverflow)).toBe(
    true,
  );
});
