import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Valor ficticio solo para pruebas; no es un secreto real.
        bindings: { INTERNAL_TOKEN: "test-internal-token-0000000000000000" },
      },
    }),
  ],
});
