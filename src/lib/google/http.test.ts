import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GmailApiError, GmailNetworkError, GmailRateLimitError } from "@/lib/gmail/client";
import { buildUrl, googleRequest, isRateLimit } from "./http";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildUrl", () => {
  it("monta a query ignorando valores vazios ou indefinidos", () => {
    expect(buildUrl("https://x.test", "/a", { b: 1, c: true, d: undefined, e: "" })).toBe("https://x.test/a?b=1&c=true");
    expect(buildUrl("https://x.test", "/a")).toBe("https://x.test/a");
  });
});

describe("googleRequest", () => {
  const token = async () => "tok";

  it("GET devolve o JSON da resposta", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    expect(await googleRequest(token, "https://x.test/a")).toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", headers: { Authorization: "Bearer tok" } });
  });

  it("204 devolve null", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await googleRequest(token, "https://x.test/a", { method: "PATCH", body: {} })).toBeNull();
  });

  it("DELETE devolve null sem ler o corpo", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    expect(await googleRequest(token, "https://x.test/a", { method: "DELETE" })).toBeNull();
  });

  it("corpo vai como JSON com Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await googleRequest(token, "https://x.test/a", { method: "POST", body: { a: 1 } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("GET sem corpo não manda Content-Type", async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    await googleRequest(token, "https://x.test/a");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers as Record<string, string>).not.toHaveProperty("Content-Type");
  });

  it("2xx sem JSON legível vira GmailNetworkError; erro do Google vira GmailApiError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{cortado", { status: 200 }));
    await expect(googleRequest(token, "https://x.test/a")).rejects.toBeInstanceOf(GmailNetworkError);
    fetchMock.mockResolvedValueOnce(json(404, { error: { message: "nada" } }));
    await expect(googleRequest(token, "https://x.test/a")).rejects.toMatchObject({ status: 404, message: "nada" });
    fetchMock.mockResolvedValueOnce(json(404, {}));
    await expect(googleRequest(token, "https://x.test/a")).rejects.toBeInstanceOf(GmailApiError);
  });
});

describe("isRateLimit", () => {
  const forbidden = (reason: string) => ({ error: { code: 403, errors: [{ reason }] } });

  it("429 e 403 por limite de uso (inclusive a cota diária da Agenda) contam como limite", () => {
    expect(isRateLimit(429, null)).toBe(true);
    expect(isRateLimit(403, forbidden("rateLimitExceeded"))).toBe(true);
    expect(isRateLimit(403, forbidden("userRateLimitExceeded"))).toBe(true);
    expect(isRateLimit(403, forbidden("quotaExceeded"))).toBe(true);
    expect(isRateLimit(403, { error: { status: "RESOURCE_EXHAUSTED" } })).toBe(true);
  });

  it("403 por permissão não é limite", () => {
    expect(isRateLimit(403, forbidden("forbidden"))).toBe(false);
    expect(isRateLimit(403, null)).toBe(false);
    expect(isRateLimit(400, forbidden("quotaExceeded"))).toBe(false);
  });

  it("o 403 quotaExceeded vira GmailRateLimitError (adiar, não erro)", async () => {
    fetchMock.mockResolvedValueOnce(
      json(403, { error: { code: 403, message: "Calendar usage limits exceeded.", errors: [{ domain: "usageLimits", reason: "quotaExceeded" }] } }),
    );
    await expect(googleRequest(async () => "tok", "https://x.test/a")).rejects.toBeInstanceOf(GmailRateLimitError);
  });
});
