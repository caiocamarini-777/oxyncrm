import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  exchangeCode,
  GmailApiError,
  GmailAuthError,
  GmailClient,
  GmailHistoryExpiredError,
  GmailRateLimitError,
  refreshAccessToken,
  revokeToken,
} from "./client";

const KEY = Buffer.alloc(32, 1).toString("base64");
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("GMAIL_TOKEN_KEY", KEY);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const urlOf = (call: number) => new URL(fetchMock.mock.calls[call][0] as string);
const initOf = (call: number) => fetchMock.mock.calls[call][1] as RequestInit;

describe("OAuth", () => {
  it("exchangeCode envia o form e devolve os tokens", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 }));
    const before = Date.now();
    const r = await exchangeCode("the-code", "https://x.com/cb");
    expect(r.accessToken).toBe("at");
    expect(r.refreshToken).toBe("rt");
    expect(r.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
    expect(fetchMock.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
    expect(initOf(0).method).toBe("POST");
    const body = new URLSearchParams(initOf(0).body as string);
    expect(Object.fromEntries(body)).toEqual({
      code: "the-code",
      client_id: "cid",
      client_secret: "secret",
      redirect_uri: "https://x.com/cb",
      grant_type: "authorization_code",
    });
  });

  it("exchangeCode devolve refreshToken null quando o Google não envia", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: "at", expires_in: 100 }));
    expect((await exchangeCode("c", "r")).refreshToken).toBeNull();
  });

  it("refreshAccessToken usa grant_type refresh_token", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: "new", expires_in: 3599 }));
    const r = await refreshAccessToken("rt");
    expect(r.accessToken).toBe("new");
    const body = new URLSearchParams(initOf(0).body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt");
  });

  it("invalid_grant vira GmailAuthError", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_grant", error_description: "Token has been revoked" }));
    await expect(refreshAccessToken("rt")).rejects.toBeInstanceOf(GmailAuthError);
  });

  it("outro erro do token vira GmailApiError com o status", async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: "invalid_client" }));
    const err = await refreshAccessToken("rt").catch((e) => e);
    expect(err).toBeInstanceOf(GmailApiError);
    expect(err.status).toBe(400);
  });

  it("sem configuração lança erro claro", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    await expect(exchangeCode("c", "r")).rejects.toThrow(/não configurada/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revokeToken chama o endpoint e nunca lança", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await revokeToken("a b")).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/revoke?token=a%20b");
    fetchMock.mockRejectedValueOnce(new Error("rede"));
    expect(await revokeToken("x")).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    expect(await revokeToken("x")).toBe(false);
  });
});

describe("GmailClient", () => {
  const getToken = vi.fn(async (opts?: { forceRefresh?: boolean }) => (opts?.forceRefresh ? "fresh" : "old"));
  beforeEach(() => getToken.mockClear());
  const client = () => new GmailClient(getToken);

  it("getProfile", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { emailAddress: "a@b.com", historyId: "10" }));
    expect(await client().getProfile()).toEqual({ emailAddress: "a@b.com", historyId: "10" });
    expect(urlOf(0).href).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    expect((initOf(0).headers as Record<string, string>).Authorization).toBe("Bearer old");
  });

  it("listMessages monta q e pageToken e tolera resposta vazia", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "n" }));
    const r = await client().listMessages({ q: "after:2026/01/01 -in:chats", pageToken: "p" });
    expect(r).toEqual({ messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "n" });
    expect(urlOf(0).pathname).toBe("/gmail/v1/users/me/messages");
    expect(urlOf(0).searchParams.get("q")).toBe("after:2026/01/01 -in:chats");
    expect(urlOf(0).searchParams.get("pageToken")).toBe("p");
    fetchMock.mockResolvedValueOnce(json(200, { resultSizeEstimate: 0 }));
    expect((await client().listMessages({ q: "x" })).messages).toEqual([]);
  });

  it("getMessage metadata pede os cabeçalhos; full não", async () => {
    fetchMock.mockResolvedValue(json(200, { id: "m1" }));
    await client().getMessage("m1", "metadata");
    expect(urlOf(0).pathname).toBe("/gmail/v1/users/me/messages/m1");
    expect(urlOf(0).searchParams.get("format")).toBe("metadata");
    expect(urlOf(0).searchParams.getAll("metadataHeaders")).toEqual([
      "From",
      "To",
      "Cc",
      "Subject",
      "Date",
      "Message-ID",
    ]);
    await client().getMessage("m1", "full");
    expect(urlOf(1).searchParams.get("format")).toBe("full");
    expect(urlOf(1).searchParams.has("metadataHeaders")).toBe(false);
  });

  it("listHistory pede messageAdded e devolve historyId", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { history: [{ messagesAdded: [{ message: { id: "m", threadId: "t" } }] }], historyId: "99" }),
    );
    const r = await client().listHistory({ startHistoryId: "50", pageToken: "pp" });
    expect(r.historyId).toBe("99");
    expect(r.history).toHaveLength(1);
    expect(urlOf(0).pathname).toBe("/gmail/v1/users/me/history");
    expect(urlOf(0).searchParams.get("startHistoryId")).toBe("50");
    expect(urlOf(0).searchParams.get("historyTypes")).toBe("messageAdded");
    expect(urlOf(0).searchParams.get("pageToken")).toBe("pp");
  });

  it("listHistory sem alterações devolve history vazio", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { historyId: "99" }));
    expect((await client().listHistory({ startHistoryId: "50" })).history).toEqual([]);
  });

  it("404 no histórico lança GmailHistoryExpiredError; 404 em outro lugar é GmailApiError", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: { code: 404, message: "Requested entity was not found." } }));
    await expect(client().listHistory({ startHistoryId: "1" })).rejects.toBeInstanceOf(GmailHistoryExpiredError);
    fetchMock.mockResolvedValueOnce(json(404, { error: { message: "nada" } }));
    const err = await client().getMessage("zz", "full").catch((e) => e);
    expect(err).toBeInstanceOf(GmailApiError);
    expect(err.status).toBe(404);
  });

  it("listThreads usa 25 por padrão; getThread passa o formato", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { threads: [{ id: "t1", snippet: "oi" }], nextPageToken: "n" }));
    const r = await client().listThreads({ q: "from:a", pageToken: "p" });
    expect(r.threads[0].id).toBe("t1");
    expect(r.nextPageToken).toBe("n");
    expect(urlOf(0).pathname).toBe("/gmail/v1/users/me/threads");
    expect(urlOf(0).searchParams.get("maxResults")).toBe("25");
    expect(urlOf(0).searchParams.get("q")).toBe("from:a");
    fetchMock.mockResolvedValueOnce(json(200, { id: "t1", messages: [] }));
    await client().getThread("t1", "full");
    expect(urlOf(1).pathname).toBe("/gmail/v1/users/me/threads/t1");
    expect(urlOf(1).searchParams.get("format")).toBe("full");
  });

  it("send faz POST com raw e threadId", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "m9", threadId: "t9" }));
    const r = await client().send("UkFX", "t9");
    expect(r).toEqual({ id: "m9", threadId: "t9" });
    expect(urlOf(0).pathname).toBe("/gmail/v1/users/me/messages/send");
    expect(initOf(0).method).toBe("POST");
    expect(JSON.parse(initOf(0).body as string)).toEqual({ raw: "UkFX", threadId: "t9" });
    fetchMock.mockResolvedValueOnce(json(200, { id: "m10", threadId: "t10" }));
    await client().send("UkFX");
    expect(JSON.parse(initOf(1).body as string)).toEqual({ raw: "UkFX" });
  });

  it("401 renova uma vez e repete com o token novo", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { message: "Invalid Credentials" } }))
      .mockResolvedValueOnce(json(200, { emailAddress: "a@b.com", historyId: "1" }));
    const r = await client().getProfile();
    expect(r.emailAddress).toBe("a@b.com");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect((initOf(0).headers as Record<string, string>).Authorization).toBe("Bearer old");
    expect((initOf(1).headers as Record<string, string>).Authorization).toBe("Bearer fresh");
  });

  it("401 de novo depois de renovar lança GmailAuthError, sem laço", async () => {
    fetchMock.mockResolvedValue(json(401, { error: {} }));
    await expect(client().getProfile()).rejects.toBeInstanceOf(GmailAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 e 403 de limite lançam GmailRateLimitError; outro 403 não", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: { message: "slow down" } }));
    await expect(client().getProfile()).rejects.toBeInstanceOf(GmailRateLimitError);
    fetchMock.mockResolvedValueOnce(json(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }));
    await expect(client().getProfile()).rejects.toBeInstanceOf(GmailRateLimitError);
    fetchMock.mockResolvedValueOnce(json(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }));
    await expect(client().getProfile()).rejects.toBeInstanceOf(GmailRateLimitError);
    fetchMock.mockResolvedValueOnce(json(403, { error: { message: "insufficientPermissions", errors: [{ reason: "insufficientPermissions" }] } }));
    const err = await client().getProfile().catch((e) => e);
    expect(err).toBeInstanceOf(GmailApiError);
    expect(err.status).toBe(403);
  });
});
