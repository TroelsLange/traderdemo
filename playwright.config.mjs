// Browsertests mod tests/server.mjs (rigtige funktioner, falsk Energi Data Service, bog i hukommelsen).
import { defineConfig } from "@playwright/test";

const PORT = 8899;
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1, // testene deler én server og styrer dens klokke
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", locale: "da-DK", timezoneId: "Europe/Copenhagen" },
  webServer: { command: `node tests/server.mjs ${PORT}`, url: `http://localhost:${PORT}/__health`, reuseExistingServer: !process.env.CI },
});
