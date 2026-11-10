import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** CSS do Google Fonts fixo no servidor dos e2e (o temporário do import.spec também usa); ver o arquivo. */
const googleFontsMock = path.join(__dirname, "e2e/fixtures/google-fonts.cjs");

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1, // os testes compartilham o banco de dev
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: true,
        env: { NEXT_FONT_GOOGLE_MOCKED_RESPONSES: googleFontsMock },
      },
});
