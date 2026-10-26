import { describe, expect, it, vi } from "vitest";
import { createPipedriveClient, retryAfterMs, PipedriveAuthError, PipedriveError } from "./client";

vi.mock("server-only", () => ({}));

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("cliente do Pipedrive", () => {
  it("429 com Retry-After e depois 200 dá sucesso, esperando o tempo", async () => {
    const waits: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(json({ data: [{ id: 1 }] }));
    const c = createPipedriveClient({
      token: "SEGREDO", baseUrl: "https://x.test/", fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: async (ms) => void waits.push(ms),
    });
    expect(await c.pipelines()).toEqual([{ id: 1 }]);
    expect(waits).toEqual([3000, 2000]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.test/v1/pipelines?limit=500");
    expect((init as RequestInit).headers).toMatchObject({ "x-api-token": "SEGREDO" });
    expect(String(url)).not.toContain("SEGREDO");
  });

  it("401 dá PipedriveAuthError sem tentar de novo", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const c = createPipedriveClient({ token: "SEGREDO", fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: async () => {} });
    await expect(c.me()).rejects.toBeInstanceOf(PipedriveAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("desiste após 5 novas tentativas, sem vazar o token", async () => {
    const waits: number[] = [];
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const c = createPipedriveClient({
      token: "SEGREDO", fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: async (ms) => void waits.push(ms),
    });
    const err = await c.users().catch((e) => e);
    expect(err).toBeInstanceOf(PipedriveError);
    expect(String(err.message)).not.toContain("SEGREDO");
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("pagina seguindo next_start e usa os filtros de negócios e atividades", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 1 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 2 } } }))
      .mockResolvedValueOnce(json({ data: [{ id: 2 }], additional_data: { pagination: { more_items_in_collection: false } } }))
      .mockResolvedValueOnce(json({ data: null }));
    const c = createPipedriveClient({ token: "t", baseUrl: "https://x.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const p1 = await c.page("deals", 0, 2);
    expect(p1).toEqual({ items: [{ id: 1 }], nextStart: 2 });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://x.test/v1/deals?status=all_not_deleted&start=0&limit=2");
    const p2 = await c.page("deals", 2, 2);
    expect(p2).toEqual({ items: [{ id: 2 }], nextStart: null });
    await c.page("activities", 0);
    expect(fetchImpl.mock.calls[2][0]).toBe("https://x.test/v1/activities?user_id=0&start=0&limit=500");
  });

  it("pagina leads arquivados em /v1/leads/archived", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ data: [{ id: "u" }], additional_data: { next_start: 5, pagination: { more_items_in_collection: true, next_start: 5 } } }));
    const c = createPipedriveClient({ token: "t", baseUrl: "https://x.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await c.page("archivedLeads", 0, 5)).toEqual({ items: [{ id: "u" }], nextStart: 5 });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://x.test/v1/leads/archived?start=0&limit=5");
  });

  it("sem next_start usa start + itens; página vazia encerra", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ data: [{ id: 1 }, { id: 2 }], additional_data: { pagination: { more_items_in_collection: true } } }))
      .mockResolvedValueOnce(json({ data: [], additional_data: { pagination: { more_items_in_collection: true } } }));
    const c = createPipedriveClient({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await c.page("persons", 10, 2)).nextStart).toBe(12);
    expect((await c.page("persons", 12, 2)).nextStart).toBeNull();
  });

  it("Retry-After em data HTTP e espera limitada a 60s", async () => {
    const at = new Date(Date.now() + 10_000).toUTCString();
    const ms = retryAfterMs(new Response("", { headers: { "retry-after": at } }));
    expect(ms).toBeGreaterThan(7000);
    expect(ms).toBeLessThanOrEqual(10_000);
    const waits: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3600" } }))
      .mockResolvedValueOnce(json({ data: [] }));
    const c = createPipedriveClient({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: async (m) => void waits.push(m) });
    await c.stages();
    expect(waits).toEqual([60_000]);
  });

  it("usa timeout, repete após erro de rede e cancela o corpo antes de repetir", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const bad = { status: 502, ok: false, headers: new Headers(), body: { cancel } } as unknown as Response;
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"))
      .mockResolvedValueOnce(bad)
      .mockResolvedValueOnce(json({ data: [{ id: 1 }] }));
    const c = createPipedriveClient({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: async () => {} });
    expect(await c.leadLabels()).toEqual([{ id: 1 }]);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
