import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4321", browserName: "chromium" },
  projects: [
    { name: "desktop", testIgnore: /conquete\.spec/, use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", testIgnore: /conquete\.spec/, use: { viewport: { width: 375, height: 812 }, hasTouch: true } },
    // Le parcours complet du jeu : une seule partie, sur un vrai Postgres, joue dans l'ordre.
    { name: "conquete", testMatch: /conquete\.spec/, fullyParallel: false, use: { baseURL: "http://127.0.0.1:4322", viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: "npm run preview -- --host 127.0.0.1 --port 4321",
      url: "http://127.0.0.1:4321",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "npx tsx tests/support/conquete-stack.ts",
      url: "http://127.0.0.1:4322/conquete",
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: "pipe",
    },
  ],
});
