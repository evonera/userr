import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  reporter: "line",
  use: { ...devices["Desktop Chrome"] },
});
