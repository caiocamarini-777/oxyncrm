import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1, // os testes compartilham o banco de dev
  // Sem segunda tentativa de propósito: falha intermitente fica vermelha e é investigada. Foi assim que apareceu
  // a janela de Concluir sumindo no card (Planejado dentro do Suspense, PR #45). Teste que interage logo depois do
  // goto deve esperar a hidratação (ex.: dragCard em helpers/kanban.ts, pickAvatar em profile.spec.ts).
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
