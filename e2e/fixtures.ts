import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";

// Valor con forma de UUID que acepta la sesión simulada (apps/web/src/lib/server/sesion.ts).
const SESION_DEMO = "00000000-0000-4000-8000-000000000001";

// El servidor bajo prueba es local. Evita que Google Fonts bloquee la hidratación
// o vuelva dependiente de Internet una suite de datos simulados.
// `sesion` (por defecto true) precarga la cookie de sesión simulada para las rutas
// internas; los tests de acceso la desactivan con `test.use({ sesion: false })`.
export const test = base.extend<{ sesion: boolean }>({
  sesion: [true, { option: true }],
  page: async ({ page, context, baseURL, sesion }, use) => {
    if (sesion) {
      await context.addCookies([
        { name: "demo_sesion", value: SESION_DEMO, url: baseURL ?? "http://127.0.0.1:4179" },
      ]);
    }
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    await use(page);
  },
});
