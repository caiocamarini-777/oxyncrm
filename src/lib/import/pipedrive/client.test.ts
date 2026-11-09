import { describe, expect, it, vi } from "vitest";
import { createPipedriveClient, retryAfterMs, PipedriveAuthError, PipedriveError, REQUEST_TOTAL_MS } from "./client";

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

  it("next_start que não avança cai em start + itens", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => json({ data: [{ id: 1 }, { id: 2 }], additional_data: { pagination: { more_items_in_collection: true, next_start: 10 } } }));
    const c = createPipedriveClient({ token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await c.page("persons", 10, 2)).nextStart).toBe(12);
    expect((await c.page("persons", 20, 2)).nextStart).toBe(22);
  });

  describe("escritas", () => {
    const mk = (fetchImpl: unknown, extra: Partial<Parameters<typeof createPipedriveClient>[0]> = {}) =>
      createPipedriveClient({
        token: "SEGREDO", baseUrl: "https://x.test/", fetchImpl: fetchImpl as typeof fetch, sleepImpl: async () => {}, ...extra,
      });

    it("post, put e patch mandam método, JSON e headers certos e devolvem o data do envelope", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(json({ success: true, data: { id: 10 } }, { status: 201 }))
        .mockResolvedValueOnce(json({ success: true, data: { id: 10, name: "B" } }))
        .mockResolvedValueOnce(json({ success: true, data: { id: "uuid" } }));
      const c = mk(fetchImpl);
      expect(await c.post("/v1/persons", { name: "A", email: ["a@x.com"] })).toEqual({ id: 10 });
      expect(await c.put("/v1/persons/10", { name: "B" })).toEqual({ id: 10, name: "B" });
      expect(await c.patch("/v1/leads/uuid", { title: "L" })).toEqual({ id: "uuid" });

      const calls = fetchImpl.mock.calls.map(([url, init]) => [url, init as RequestInit]);
      expect(calls.map(([url, init]) => [init.method, url])).toEqual([
        ["POST", "https://x.test/v1/persons"],
        ["PUT", "https://x.test/v1/persons/10"],
        ["PATCH", "https://x.test/v1/leads/uuid"],
      ]);
      expect(calls.map(([, init]) => init.body)).toEqual([
        JSON.stringify({ name: "A", email: ["a@x.com"] }),
        JSON.stringify({ name: "B" }),
        JSON.stringify({ title: "L" }),
      ]);
      for (const [url, init] of calls) {
        expect(init.headers).toMatchObject({
          "x-api-token": "SEGREDO", "content-type": "application/json", accept: "application/json",
        });
        expect(String(url)).not.toContain("SEGREDO");
        expect(init.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it("data ausente no envelope vira undefined", async () => {
      const c = mk(vi.fn().mockResolvedValue(json({ success: true })));
      expect(await c.post("/v1/notes", { content: "x" })).toBeUndefined();
    });

    it("429 com Retry-After e depois 200: espera, repete o mesmo corpo e dá sucesso", async () => {
      const waits: number[] = [];
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3" } }))
        .mockResolvedValueOnce(new Response("", { status: 503 }))
        .mockResolvedValueOnce(json({ data: { id: 7 } }));
      const c = mk(fetchImpl, { sleepImpl: async (ms) => void waits.push(ms) });
      expect(await c.post("/v1/deals", { title: "N" })).toEqual({ id: 7 });
      expect(waits).toEqual([3000, 2000]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      for (const [, init] of fetchImpl.mock.calls) {
        expect((init as RequestInit).method).toBe("POST");
        expect((init as RequestInit).body).toBe(JSON.stringify({ title: "N" }));
      }
    });

    it("401 em qualquer escrita vira PipedriveAuthError sem tentar de novo", async () => {
      for (const call of [
        (c: ReturnType<typeof mk>) => c.post("/v1/persons", {}),
        (c: ReturnType<typeof mk>) => c.put("/v1/persons/1", {}),
        (c: ReturnType<typeof mk>) => c.patch("/v1/leads/u", {}),
        (c: ReturnType<typeof mk>) => c.del("/v1/persons/1"),
      ]) {
        const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
        await expect(call(mk(fetchImpl))).rejects.toBeInstanceOf(PipedriveAuthError);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    });

    it("erro 4xx não repete, leva o status e não vaza token nem corpo", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("segredo no corpo", { status: 400 }));
      const err = (await mk(fetchImpl).post("/v1/persons?x=1", { name: "A" }).catch((e: unknown) => e)) as PipedriveError;
      expect(err).toBeInstanceOf(PipedriveError);
      expect(err.status).toBe(400);
      expect(String(err.message)).toContain("/v1/persons");
      expect(String(err.message)).not.toContain("SEGREDO");
      expect(String(err.message)).not.toContain("segredo no corpo");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("escrita desiste após 5 novas tentativas no 5xx, mesmas esperas da leitura", async () => {
      const waits: number[] = [];
      const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
      const c = mk(fetchImpl, { sleepImpl: async (ms) => void waits.push(ms) });
      await expect(c.put("/v1/deals/1", { title: "x" })).rejects.toBeInstanceOf(PipedriveError);
      expect(waits).toEqual([1000, 2000, 4000, 8000, 16000]);
      expect(fetchImpl).toHaveBeenCalledTimes(6);
    });

    it("escrita respeita o teto total de 90 s", async () => {
      let clock = 0;
      const waits: number[] = [];
      const fetchImpl = vi.fn().mockImplementation(async () => {
        clock += 20_000;
        return new Response("", { status: 503 });
      });
      const c = mk(fetchImpl, {
        nowImpl: () => clock,
        sleepImpl: async (ms) => {
          waits.push(ms);
          clock += ms;
        },
      });
      await expect(c.post("/v1/notes", { content: "x" })).rejects.toBeInstanceOf(PipedriveError);
      expect(clock).toBeLessThanOrEqual(REQUEST_TOTAL_MS);
      expect(waits).toEqual([1000, 2000, 4000]);
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    });

    it("del usa DELETE sem corpo nem content-type e devolve void", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(json({ success: true, data: { id: 5 } }));
      expect(await mk(fetchImpl).del("/v1/persons/5")).toBeUndefined();
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://x.test/v1/persons/5");
      expect(init.method).toBe("DELETE");
      expect(init.body).toBeUndefined();
      expect(init.headers).toMatchObject({ "x-api-token": "SEGREDO" });
      expect(init.headers).not.toHaveProperty("content-type");
    });

    it("del tolera corpo vazio ou fora do padrão em 2xx", async () => {
      for (const res of [() => new Response(null, { status: 204 }), () => new Response("não é json", { status: 200 })]) {
        const fetchImpl = vi.fn().mockImplementation(async () => res());
        await expect(mk(fetchImpl).del("/v1/notes/1")).resolves.toBeUndefined();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
      }
    });

    it("404 no del não lança (já apagado) e não repete", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
      await expect(mk(fetchImpl).del("/v1/persons/9")).resolves.toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("404 em post, put e patch continua sendo erro", async () => {
      for (const call of [
        (c: ReturnType<typeof mk>) => c.post("/v1/x", {}),
        (c: ReturnType<typeof mk>) => c.put("/v1/x/1", {}),
        (c: ReturnType<typeof mk>) => c.patch("/v1/x/1", {}),
      ]) {
        const err = await call(mk(vi.fn().mockResolvedValue(new Response("", { status: 404 })))).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(PipedriveError);
        expect((err as PipedriveError).status).toBe(404);
      }
    });

    it("del repete em 429 e em erro de rede, e outros erros (500 esgotado, 403) continuam lançando", async () => {
      const waits: number[] = [];
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } }))
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(json({ data: { id: 1 } }));
      await mk(fetchImpl, { sleepImpl: async (ms) => void waits.push(ms) }).del("/v1/deals/1");
      expect(waits).toEqual([2000, 2000]);

      const forbidden = vi.fn().mockResolvedValue(new Response("", { status: 403 }));
      await expect(mk(forbidden).del("/v1/deals/1")).rejects.toMatchObject({ status: 403 });
      expect(forbidden).toHaveBeenCalledTimes(1);
    });
  });
});
