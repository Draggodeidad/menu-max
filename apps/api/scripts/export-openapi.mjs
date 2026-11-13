import { mkdir, writeFile } from "node:fs/promises";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [
    {
      configPath: new URL("../wrangler.jsonc", import.meta.url),
      vars: {
        ENVIRONMENT: "development",
        WEB_ORIGIN: "http://localhost:5173",
        EMAIL_FROM: "MenusMax <no-responder@example.com>",
      },
      // Valor ficticio para validar los bindings del Worker local.
      secrets: {
        INTERNAL_TOKEN: "openapi-export-local-placeholder",
        BETTER_AUTH_SECRET: "openapi-export-local-placeholder".repeat(2),
        RESEND_API_KEY: "openapi-export-local-placeholder",
        // Clave de prueba de Cloudflare que siempre pasa; el export no llama a Turnstile.
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      },
    },
  ],
});

try {
  await server.listen();
  const response = await server.fetch("/openapi.json");
  if (!response.ok) {
    throw new Error(`No se pudo exportar OpenAPI (HTTP ${response.status}).`);
  }

  const document = await response.json();
  const directory = new URL("../../../docs/api/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("openapi.json", directory), `${JSON.stringify(document, null, 2)}\n`);
} finally {
  await server.close();
}
