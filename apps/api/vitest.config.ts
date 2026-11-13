import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Migraciones de packages/database; se aplican desde cero sobre la D1 local en el setup.
const migrations = await readD1Migrations(
  new URL("../../packages/database/migrations", import.meta.url).pathname,
);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Valor ficticio solo para pruebas; no es un secreto real.
        bindings: {
          INTERNAL_TOKEN: "test-internal-token-0000000000000000",
          BETTER_AUTH_SECRET: "vitest-local-placeholder".repeat(3),
          WEB_ORIGIN: "http://localhost:5173",
          EMAIL_FROM: "MenusMax <no-responder@example.com>",
          RESEND_API_KEY: "vitest-resend-placeholder",
          // Clave de prueba de Cloudflare que siempre pasa; siteverify se simula en las pruebas.
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
