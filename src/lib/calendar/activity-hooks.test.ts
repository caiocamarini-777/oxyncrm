import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  pushActivity: vi.fn(),
  gmailConfig: vi.fn(),
  createAdminClient: vi.fn(),
  calendarClientForAccount: vi.fn(),
}));

vi.mock("./push", () => ({ pushActivity: mocks.pushActivity }));
vi.mock("./google", () => ({ calendarClientForAccount: mocks.calendarClientForAccount }));
vi.mock("@/lib/gmail/oauth", () => ({ gmailConfig: mocks.gmailConfig }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { afterActivityWrite, PUSH_CAP_MS } from "./activity-hooks";
import type { CalendarDeps } from "./push";

const ADMIN = { admin: true };
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://crm.oxyn.app");
  mocks.gmailConfig.mockReturnValue({ clientId: "c", clientSecret: "s", tokenKey: "k" });
  mocks.createAdminClient.mockReturnValue(ADMIN);
  mocks.pushActivity.mockResolvedValue("synced");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("afterActivityWrite", () => {
  it("envia a atividade com o cliente admin, o cliente da Agenda da caixa e a base do link do CRM", async () => {
    await afterActivityWrite("a-1");

    expect(mocks.pushActivity).toHaveBeenCalledTimes(1);
    const [deps, id, opts] = mocks.pushActivity.mock.calls[0] as [CalendarDeps, string, unknown];
    expect(id).toBe("a-1");
    // Convite e avisos valem por padrão: só a primeira rodada do cron passa `invite: false`.
    expect(opts).toBeUndefined();
    expect(deps.db).toBe(ADMIN);
    expect(deps.clientFor).toBe(mocks.calendarClientForAccount);
    expect(deps.appUrl).toBe("https://crm.oxyn.app");
    expect(deps.now()).toBeInstanceOf(Date);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("sem NEXT_PUBLIC_SITE_URL, o evento vai sem o link (base vazia)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    await afterActivityWrite("a-1");
    expect((mocks.pushActivity.mock.calls[0][0] as CalendarDeps).appUrl).toBe("");
  });

  it("devolve qualquer resultado do envio sem mudar nada (skipped, deferred, error)", async () => {
    for (const r of ["skipped", "deferred", "error"]) {
      mocks.pushActivity.mockResolvedValueOnce(r);
      await expect(afterActivityWrite("a-1")).resolves.toBeUndefined();
    }
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("com o Google (ou o banco) lançando, não lança: só vai para o log", async () => {
    mocks.pushActivity.mockRejectedValue(new Error("Falha do Google: 500"));
    await expect(afterActivityWrite("a-1")).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith("agenda: falha ao enviar a atividade", "a-1", "Falha do Google: 500");
  });

  it("erro que não é Error também só vai para o log", async () => {
    mocks.pushActivity.mockRejectedValue("quebrou");
    await expect(afterActivityWrite("a-1")).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith("agenda: falha ao enviar a atividade", "a-1", "quebrou");
  });

  it("falha ao montar o envio (cliente admin sem as variáveis) não lança", async () => {
    mocks.createAdminClient.mockImplementation(() => {
      throw new Error("supabaseUrl is required.");
    });
    await expect(afterActivityWrite("a-1")).resolves.toBeUndefined();
    expect(mocks.pushActivity).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith("agenda: falha ao enviar a atividade", "a-1", "supabaseUrl is required.");
  });

  it("com o teto estourado, devolve sem esperar o envio, e a falha tardia não vira rejeição sem dono", async () => {
    let fail!: (e: Error) => void;
    mocks.pushActivity.mockReturnValue(new Promise((_, reject) => (fail = reject)));

    let done = false;
    const run = afterActivityWrite("a-1").then(() => (done = true));

    await vi.advanceTimersByTimeAsync(PUSH_CAP_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(done).toBe(true);
    expect(errorLog).toHaveBeenCalledWith("agenda: envio da atividade passou do teto; o cron termina", "a-1");

    // O envio que ficou para trás termina depois: o erro é logado, sem rejeição não tratada.
    fail(new Error("tarde demais"));
    await vi.advanceTimersByTimeAsync(0);
    expect(errorLog).toHaveBeenCalledWith("agenda: falha ao enviar a atividade", "a-1", "tarde demais");
  });

  it("o teto é de 8 segundos", () => {
    expect(PUSH_CAP_MS).toBe(8_000);
  });

  it("envio que termina dentro do teto não deixa o relógio do teto pendente", async () => {
    await afterActivityWrite("a-1");
    expect(vi.getTimerCount()).toBe(0);
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("sem o OAuth do Google configurado, não faz nada (a atividade fica pendente)", async () => {
    mocks.gmailConfig.mockReturnValue(null);
    await expect(afterActivityWrite("a-1")).resolves.toBeUndefined();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.pushActivity).not.toHaveBeenCalled();
  });
});
