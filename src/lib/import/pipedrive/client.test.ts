import { describe, expect, it, vi } from "vitest";
import {
  createPipedriveClient, retryAfterMs, PipedriveAuthError, PipedriveError, REQUEST_TOTAL_MS, DOWNLOAD_TOTAL_MS,
} from "./client";

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

  it("teto total por chamada: tentativas e esperas não passam de 90 s", async () => {
    let clock = 0;
    const waits: number[] = [];
    // cada tentativa leva 20 s até falhar (5xx lento)
    const fetchImpl = vi.fn().mockImplementation(async () => {
      clock += 20_000;
      return new Response("", { status: 503 });
    });
    const c = createPipedriveClient({
      token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, nowImpl: () => clock,
      sleepImpl: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    const err = await c.users().catch((e) => e);
    expect(err).toBeInstanceOf(PipedriveError);
    expect(REQUEST_TOTAL_MS).toBe(90_000);
    expect(clock).toBeLessThanOrEqual(REQUEST_TOTAL_MS);
    // 20 + 1 + 20 + 2 + 20 + 4 + 20 = 87 s; a próxima espera (8 s) passaria do teto: para
    expect(waits).toEqual([1000, 2000, 4000]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("Retry-After maior que o tempo restante: desiste sem esperar", async () => {
    let clock = 0;
    const waits: number[] = [];
    const fetchImpl = vi.fn().mockImplementation(async () => {
      clock += 40_000;
      return new Response("", { status: 429, headers: { "retry-after": "60" } });
    });
    const c = createPipedriveClient({
      token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, nowImpl: () => clock,
      sleepImpl: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await expect(c.users()).rejects.toBeInstanceOf(PipedriveError);
    expect(waits).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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

  it("get devolve data e nextStart da paginação", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({ success: true, data: [{ id: 1 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 100 } } }),
      )
      .mockResolvedValueOnce(
        json({ success: true, data: [{ id: 2 }], additional_data: { pagination: { more_items_in_collection: false, next_start: 200 } } }),
      )
      .mockResolvedValueOnce(json({ success: true, data: { id: 3 } }));
    const c = createPipedriveClient({ token: "SEGREDO", baseUrl: "https://x.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await c.get("/v1/persons/5/mailMessages?start=0&limit=100")).toEqual({ data: [{ id: 1 }], nextStart: 100 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.test/v1/persons/5/mailMessages?start=0&limit=100");
    expect((init as RequestInit).headers).toMatchObject({ "x-api-token": "SEGREDO" });
    expect(String(url)).not.toContain("SEGREDO");
    // sem mais itens: nextStart nulo, mesmo com next_start presente
    expect(await c.get("/v1/persons/5/mailMessages?start=100&limit=100")).toEqual({ data: [{ id: 2 }], nextStart: null });
    // sem paginação: nextStart nulo
    expect(await c.get("/v1/files/9")).toEqual({ data: { id: 3 }, nextStart: null });
  });

  it("get tenta de novo no 429", async () => {
    const waits: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(json({ success: true, data: [{ id: 1 }] }));
    const c = createPipedriveClient({
      token: "t", fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: async (ms) => void waits.push(ms),
    });
    expect(await c.get("/v1/files?start=0")).toEqual({ data: [{ id: 1 }], nextStart: null });
    expect(waits).toEqual([1000]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("download devolve os bytes e o content-type", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/pdf" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4])));
    const c = createPipedriveClient({ token: "SEGREDO", baseUrl: "https://x.test/", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await c.download("/v1/files/7/download");
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
    expect(out.contentType).toBe("application/pdf");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.test/v1/files/7/download");
    expect((init as RequestInit).headers).toMatchObject({ "x-api-token": "SEGREDO" });
    // sem content-type na resposta
    expect((await c.download("/v1/files/8/download")).contentType).toBeNull();
  });

  it("download lança PipedriveAuthError no 401", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    const c = createPipedriveClient({ token: "SEGREDO", fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: async () => {} });
    await expect(c.download("/v1/files/7/download")).rejects.toBeInstanceOf(PipedriveAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("download tenta de novo no 5xx e desiste sem vazar o token", async () => {
    const waits: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([9])));
    const c = createPipedriveClient({
      token: "SEGREDO", fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: async (ms) => void waits.push(ms),
    });
    expect(Array.from((await c.download("/v1/files/7/download")).bytes)).toEqual([9]);
    expect(waits).toEqual([1000]);

    const sempre500 = vi.fn().mockImplementation(async () => new Response("", { status: 500 }));
    const c2 = createPipedriveClient({ token: "SEGREDO", fetchImpl: sempre500 as unknown as typeof fetch, sleepImpl: async () => {} });
    const err = await c2.download("/v1/files/7/download").catch((e) => e);
    expect(err).toBeInstanceOf(PipedriveError);
    expect(String(err.message)).not.toContain("SEGREDO");
    expect(sempre500).toHaveBeenCalledTimes(6);
  });

  it("download segue o redirecionamento sem repassar o token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://files.example.com/x?sig=1" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8]), { headers: { "content-type": "image/png" } }));
    const c = createPipedriveClient({ token: "SEGREDO", baseUrl: "https://x.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await c.download("/v1/files/7/download");
    expect(Array.from(out.bytes)).toEqual([7, 8]);
    expect(out.contentType).toBe("image/png");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url1, init1] = fetchImpl.mock.calls[0];
    expect(url1).toBe("https://x.test/v1/files/7/download");
    expect((init1 as RequestInit).redirect).toBe("manual");
    expect((init1 as RequestInit).headers).toMatchObject({ "x-api-token": "SEGREDO" });
    const [url2, init2] = fetchImpl.mock.calls[1];
    expect(url2).toBe("https://files.example.com/x?sig=1");
    expect((init2 as RequestInit).redirect).toBe("manual");
    const headers2 = (init2 as RequestInit).headers as Record<string, string>;
    expect(Object.keys(headers2).map((k) => k.toLowerCase())).not.toContain("x-api-token");
    expect(JSON.stringify(init2)).not.toContain("SEGREDO");
  });

  it("download resolve Location relativo e segue até 3 redirecionamentos", async () => {
    const redirect = (location: string) => new Response("", { status: 301, headers: { location } });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirect("/files/a"))
      .mockResolvedValueOnce(redirect("https://cdn.example.com/b"))
      .mockResolvedValueOnce(redirect("/c"))
      .mockResolvedValueOnce(new Response(new Uint8Array([1])));
    const c = createPipedriveClient({ token: "SEGREDO", baseUrl: "https://x.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(Array.from((await c.download("/v1/files/7/download")).bytes)).toEqual([1]);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      "https://x.test/v1/files/7/download",
      "https://x.test/files/a",
      "https://cdn.example.com/b",
      "https://cdn.example.com/c",
    ]);
  });

  it("download desiste com redirecionamentos demais, sem destino ou erro no destino, sem vazar token nem URL", async () => {
    const redirect = (location: string) => new Response("", { status: 302, headers: { location } });
    const sempreRedireciona = vi.fn().mockImplementation(async () => redirect("https://files.example.com/x?sig=SEGREDO2"));
    const c1 = createPipedriveClient({ token: "SEGREDO", fetchImpl: sempreRedireciona as unknown as typeof fetch, sleepImpl: async () => {} });
    const e1 = await c1.download("/v1/files/7/download?k=1").catch((e) => e);
    expect(e1).toBeInstanceOf(PipedriveError);
    expect(sempreRedireciona).toHaveBeenCalledTimes(4); // a original + 3 saltos
    expect(String(e1.message)).not.toMatch(/SEGREDO|files\.example\.com|k=1/);

    const semLocation = vi.fn().mockResolvedValue(new Response("", { status: 302 }));
    const c2 = createPipedriveClient({ token: "SEGREDO", fetchImpl: semLocation as unknown as typeof fetch, sleepImpl: async () => {} });
    await expect(c2.download("/v1/files/7/download")).rejects.toBeInstanceOf(PipedriveError);
    expect(semLocation).toHaveBeenCalledTimes(1);

    const destino403 = vi
      .fn()
      .mockResolvedValueOnce(redirect("https://files.example.com/x?sig=SEGREDO2"))
      .mockResolvedValueOnce(new Response("", { status: 403 }));
    const c3 = createPipedriveClient({ token: "SEGREDO", fetchImpl: destino403 as unknown as typeof fetch, sleepImpl: async () => {} });
    const e3 = await c3.download("/v1/files/7/download").catch((e) => e);
    expect(e3).toBeInstanceOf(PipedriveError);
    expect(e3).not.toBeInstanceOf(PipedriveAuthError);
    expect(e3.status).toBe(403);
    expect(String(e3.message)).not.toMatch(/SEGREDO|files\.example\.com/);
    expect(destino403).toHaveBeenCalledTimes(2); // erro no destino não é repetido
  });

  it("download repete o 5xx do Pipedrive e depois segue o redirecionamento", async () => {
    const waits: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://files.example.com/x" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([5])));
    const c = createPipedriveClient({
      token: "SEGREDO", fetchImpl: fetchImpl as unknown as typeof fetch, sleepImpl: async (ms) => void waits.push(ms),
    });
    expect(Array.from((await c.download("/v1/files/7/download")).bytes)).toEqual([5]);
    expect(waits).toEqual([1000]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("download usa tentativa de 120 s e teto de 300 s; as chamadas JSON seguem com 30 s", async () => {
    expect(DOWNLOAD_TOTAL_MS).toBe(300_000);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response(new Uint8Array([1])))
        .mockResolvedValueOnce(json({ data: [] }));
      const c = createPipedriveClient({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
      await c.download("/v1/files/7/download");
      await c.stages();
      expect(timeout.mock.calls.map((a) => a[0])).toEqual([120_000, 30_000]);
    } finally {
      timeout.mockRestore();
    }

    // teto total do download: cada tentativa leva 100 s até falhar (5xx lento)
    let clock = 0;
    const waits: number[] = [];
    const lento = vi.fn().mockImplementation(async () => {
      clock += 100_000;
      return new Response("", { status: 503 });
    });
    const c = createPipedriveClient({
      token: "t", fetchImpl: lento as unknown as typeof fetch, nowImpl: () => clock,
      sleepImpl: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    await expect(c.download("/v1/files/7/download")).rejects.toBeInstanceOf(PipedriveError);
    // 100 + 1 + 100 + 2 + 100 = 303 s: a próxima espera (4 s) já não cabe no teto de 300 s, então para
    expect(waits).toEqual([1000, 2000]);
    expect(lento).toHaveBeenCalledTimes(3);
  });

  it("next_start que não avança cai em start + itens", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => json({ data: [{ id: 1 }, { id: 2 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 10 } } }));
    const c = createPipedriveClient({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await c.page("persons", 10, 2)).nextStart).toBe(12);
    expect((await c.page("persons", 20, 2)).nextStart).toBe(22);
  });
});
