import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1, // os testes compartilham o banco de dev
  // No CI, uma segunda tentativa para o teste que falhar: com o next dev, a primeira visita a uma rota compila
  // na hora e a hidratação às vezes atrasa. O relatório mostra à parte quem só passou na segunda ("flaky").
  retries: process.env.CI ? 1 : 0,
  use: { baseURL },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: true,
      },
});
