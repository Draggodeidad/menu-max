import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";

// El servidor bajo prueba es local. Evita que Google Fonts bloquee la hidratación
// o vuelva dependiente de Internet una suite de datos simulados.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
      route.fulfill({ status: 200, contentType: "text/css", body: "" }),
    );
    await use(page);
  },
});
