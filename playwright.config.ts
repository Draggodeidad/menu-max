import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 4_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/resultados.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4179",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-1280",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
    {
      name: "movil-375",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "pnpm --filter @menu-max/web dev --host 127.0.0.1 --port 4179 --strictPort",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
