import { expect, type Page } from "@playwright/test";

// En modo dev, Svelte añade esta marca al hidratar nodos; evita interactuar
// con HTML SSR antes de que sus controladores estén listos.
export async function ir(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const contenido = document.querySelector("main") ?? document.querySelector("h1");
    return contenido !== null && Object.hasOwn(contenido, "__svelte_meta");
  });
  return response;
}

export const menu = "/m/tacos-el-guero";

export const invitationEmail = "equipo@example.com";

export function invitationUrl(state?: string) {
  const query = new URLSearchParams({ token: "equipo-demo" });
  if (state) query.set("estado", state);
  return `/invitacion?${query}`;
}

export async function abrirPedido(page: Page, query = "") {
  await ir(page, menu);
  await page.getByRole("button", { name: "Agregar Agua de horchata (1 L)" }).click();
  await page.getByRole("link", { name: /Ver pedido/ }).click();
  await expect(page.getByRole("heading", { name: "Tu pedido", exact: true })).toBeVisible();
  if (query) await ir(page, `${menu}/pedido${query}`);
}

export async function enviarPedido(page: Page) {
  await abrirPedido(page);
  await page.getByLabel("Nombre completo").fill("Ana Prueba");
  await page.getByLabel("Teléfono (WhatsApp)").fill("5512345678");
  await page.getByRole("button", { name: /Enviar pedido/ }).click();
  await expect(page).toHaveURL(/\/pedido\/[\w-]+$/);
}
