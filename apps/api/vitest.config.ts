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
          MEDIA_PUBLIC_BASE_URL: "https://img.example.com",
          // Clave de prueba de Cloudflare que siempre pasa; siteverify se simula en las pruebas.
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          PHONE_HASH_SALT: "vitest-phone-salt-placeholder".repeat(2),
          ORDER_TOKEN_SECRET: "vitest-order-token-placeholder".repeat(2),
          TEST_MIGRATIONS: migrations,
        },
        // Cola sin consumidor: la entrega real correría `queue()` mientras Vitest cierra el archivo
        // de pruebas (`EnvironmentTeardownError`). El consumidor se prueba llamándolo directo.
        queueProducers: { JOBS: { queueName: "menusmax-jobs-test" } },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
