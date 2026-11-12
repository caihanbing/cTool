import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/extension",
  timeout: 20_000,
  expect: { timeout: 3_000 },
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/fixture-server.mjs",
    url: "http://127.0.0.1:41739/health",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000
  }
});
