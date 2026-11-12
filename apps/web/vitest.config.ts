import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "cloudflare-workers-test",
      resolveId(id) {
        if (id === "cloudflare:workers") return id;
      },
    },
  ],
});
