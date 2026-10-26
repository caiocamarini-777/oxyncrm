import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTINUE_ERRORS,
  SIMULATION_TOTAL_MS,
  SLICE_BUDGET_MS,
  TRANSIENT_RETRY_MS,
  continueJob,
  isTransientError,
  simulateUntil,
  withTransientRetry,
  type ContinueResult,
  type JobState,
  type SliceLike,
} from "./continue";
import { LOG_LIMIT, USERS_CHECK_FAILURE, usersCheckPairs } from "./constants";

vi.mock("server-only", () => ({}));

const counters = { deals: { created: 1 } };

function deps(status: string | null) {
  const run = vi.fn(async (): Promise<SliceLike> => ({ status: "running", step: "deals", counters, done: false, busy: false }));
  const load = vi.fn(async (): Promise<JobState | null> => (status ? { status, step: "persons", counters } : null));
  return { run, load };
}

describe("continueJob", () => {
  it("roda a fatia só com o job em running", async () => {
    const d = deps("running");
    const r = await continueJob("j", d);
    expect(d.run).toHaveBeenCalledOnce();
    expect(r).toEqual({ ok: true, status: "running", step: "deals", counters, done: false, busy: false });
  });

  it.each(["paused", "done", "failed"])("%s devolve o estado atual sem rodar", async (status) => {
    const d = deps(status);
    const r = await continueJob("j", d);
    expect(d.run).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, status, step: "persons", counters, done: true, busy: false });
  });

  it("rascunho e job inexistente dão erro sem rodar", async () => {
    const draft = deps("draft");
    expect(await continueJob("j", draft)).toEqual({ ok: false, error: CONTINUE_ERRORS.draft });
    expect(draft.run).not.toHaveBeenCalled();
    expect(await continueJob("j", deps(null))).toEqual({ ok: false, error: CONTINUE_ERRORS.notFound });
  });
});

describe("simulateUntil", () => {
  it("termina quando a simulação chega ao fim", async () => {
    let n = 0;
    const r = await simulateUntil(async () => {
      n++;
      return n < 3 ? { status: "running", step: "persons", counters, done: false } : { status: "done", step: "done", counters, done: true };
    });
    expect(n).toBe(3);
    expect(r).toEqual({ status: "done", step: "done", counters, partial: false, message: null });
  });

  it("para no teto com contadores parciais e a etapa", async () => {
    let t = 0;
    const budgets: number[] = [];
    const r = await simulateUntil(
      async (budget) => {
        budgets.push(budget);
        t += 20_000;
        return { status: "running", step: "activities", counters, done: false };
      },
      { now: () => t },
    );
    expect(budgets).toEqual([SIMULATION_TOTAL_MS, SIMULATION_TOTAL_MS - 20_000, SIMULATION_TOTAL_MS - 40_000]);
    expect(r.partial).toBe(true);
    expect(r.counters).toBe(counters);
    expect(r.message).toBe("Simulação parcial até a etapa Atividades");
  });

  it("teto e fatia cabem no maxDuration de 60s com folga para uma unidade", () => {
    expect(SIMULATION_TOTAL_MS).toBeLessThanOrEqual(45_000);
    expect(SLICE_BUDGET_MS).toBeLessThanOrEqual(15_000);
  });
});

describe("constantes do log", () => {
  it("pares do users_check", () => {
    expect(usersCheckPairs(`${USERS_CHECK_FAILURE} Ana (Alfa); Bruno (Beta)`)).toEqual(["Ana (Alfa)", "Bruno (Beta)"]);
    expect(usersCheckPairs("Token do Pipedrive inválido")).toBeNull();
    expect(LOG_LIMIT).toBe(1000);
  });
});

describe("token do Pipedrive", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("sem token: mensagem clara, sem chamar o Pipedrive", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    delete process.env.PIPEDRIVE_API_TOKEN;
    const { loadDiscovery, PIPEDRIVE_MESSAGES } = await import("./discovery");
    expect(await loadDiscovery()).toEqual({ ok: false, error: PIPEDRIVE_MESSAGES.missing });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("token recusado (401): mensagem clara; token só no header", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    process.env.PIPEDRIVE_API_TOKEN = "falso";
    process.env.PIPEDRIVE_BASE_URL = "http://pipedrive.invalid";
    const { loadDiscovery, PIPEDRIVE_MESSAGES } = await import("./discovery");
    expect(await loadDiscovery()).toEqual({ ok: false, error: PIPEDRIVE_MESSAGES.auth });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith("http://pipedrive.invalid/v1/")).toBe(true);
    expect(url).not.toContain("falso");
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe("falso");
  });
});

describe("nova tentativa em falha passageira", () => {
  const okRes: ContinueResult = { ok: true, status: "running", step: "deals", counters, done: false, busy: false };
  const transient: ContinueResult = { ok: false, error: "A etapa atual falhou.", transient: true };
  const isTransient = (r: ContinueResult) => !r.ok && r.transient === true;

  it("reconhece erros de rede", () => {
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientError(new Error("x", { cause: new Error("ECONNRESET") }))).toBe(true);
    expect(isTransientError(new Error("Falha de rede ao chamar o Pipedrive em /v1/deals"))).toBe(true);
    expect(isTransientError(new Error("Pipedrive respondeu 503 em /v1/deals"))).toBe(true);
    expect(isTransientError(new Error("import_upsert: OXYN_IMPORT_NOT_RUNNING"))).toBe(false);
    expect(isTransientError(new Error("Pipedrive respondeu 400 em /v1/deals"))).toBe(false);
  });

  it("exceção de rede: espera 3 s e tenta uma vez", async () => {
    const waits: number[] = [];
    const call = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(okRes);
    const r = await withTransientRetry(call, { isTransient, sleep: async (ms) => void waits.push(ms) });
    expect(r).toEqual(okRes);
    expect(call).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([TRANSIENT_RETRY_MS]);
    expect(TRANSIENT_RETRY_MS).toBe(3000);
  });

  it("resultado passageiro: tenta uma vez; falhando de novo, devolve o erro", async () => {
    const call = vi.fn().mockResolvedValue(transient);
    const r = await withTransientRetry(call, { isTransient, sleep: async () => {} });
    expect(r).toEqual(transient);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("segunda exceção de rede sobe para a tela", async () => {
    const call = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(withTransientRetry(call, { isTransient, sleep: async () => {} })).rejects.toThrow("Failed to fetch");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("erro que não é de rede não tenta de novo", async () => {
    const plain: ContinueResult = { ok: false, error: "A importação ainda não foi iniciada." };
    const call = vi.fn().mockResolvedValue(plain);
    expect(await withTransientRetry(call, { isTransient, sleep: async () => {} })).toEqual(plain);
    const boom = vi.fn().mockRejectedValue(new Error("bug"));
    await expect(withTransientRetry(boom, { isTransient, sleep: async () => {} })).rejects.toThrow("bug");
    expect(call).toHaveBeenCalledTimes(1);
    expect(boom).toHaveBeenCalledTimes(1);
  });
});
