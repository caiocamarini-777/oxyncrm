import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Secret = { refresh_token_enc: string; access_token_enc: string | null; access_expires_at: string | null };
const state = vi.hoisted(() => ({
  secret: null as unknown,
  reads: 0,
  updates: [] as { table: string; values: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => ({
            overrideTypes: async () => {
              state.reads++;
              return { data: state.secret, error: null };
            },
          }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async () => {
          state.updates.push({ table, values });
          return { error: null };
        },
      }),
    }),
  }),
}));

const refresh = vi.hoisted(() => vi.fn());
vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return { ...actual, refreshAccessToken: refresh };
});

import { clientForAccount, loadAccountToken, markReconnect, needsRefresh } from "./accounts";
import { GmailAuthError } from "./client";
import { decryptToken, encryptToken } from "./crypto";

const KEY = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  state.secret = null;
  state.reads = 0;
  state.updates = [];
  refresh.mockReset();
  vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
  vi.stubEnv("GMAIL_TOKEN_KEY", KEY);
});

describe("needsRefresh", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  it("renova sem data, com data inválida ou faltando menos de 60 s", () => {
    expect(needsRefresh(null, now)).toBe(true);
    expect(needsRefresh("lixo", now)).toBe(true);
    expect(needsRefresh("2026-11-04T12:00:59Z", now)).toBe(true);
    expect(needsRefresh("2026-11-04T11:59:00Z", now)).toBe(true);
  });
  it("não renova com 60 s ou mais de folga", () => {
    expect(needsRefresh("2026-11-04T12:01:00Z", now)).toBe(false);
    expect(needsRefresh(new Date(now + 30 * 60_000), now)).toBe(false);
  });
});

describe("loadAccountToken", () => {
  const secret = (accessExpires: Date | null): Secret => ({
    refresh_token_enc: encryptToken("RT", KEY),
    access_token_enc: encryptToken("AT-guardado", KEY),
    access_expires_at: accessExpires?.toISOString() ?? null,
  });

  it("usa o access token guardado quando ainda vale", async () => {
    state.secret = secret(new Date(Date.now() + 10 * 60_000));
    expect(await loadAccountToken("acc")).toBe("AT-guardado");
    expect(refresh).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("renova perto do vencimento e grava o novo token cifrado", async () => {
    state.secret = secret(new Date(Date.now() + 10_000));
    const expiresAt = new Date(Date.now() + 3600_000);
    refresh.mockResolvedValueOnce({ accessToken: "AT-novo", expiresAt });
    expect(await loadAccountToken("acc")).toBe("AT-novo");
    expect(refresh).toHaveBeenCalledWith("RT");
    expect(state.updates).toHaveLength(1);
    const v = state.updates[0].values as { access_token_enc: string; access_expires_at: string };
    expect(state.updates[0].table).toBe("email_account_secrets");
    expect(v.access_token_enc).not.toContain("AT-novo");
    expect(decryptToken(v.access_token_enc, KEY)).toBe("AT-novo");
    expect(v.access_expires_at).toBe(expiresAt.toISOString());
  });

  it("forceRefresh renova mesmo com token válido", async () => {
    state.secret = secret(new Date(Date.now() + 10 * 60_000));
    refresh.mockResolvedValueOnce({ accessToken: "AT-novo", expiresAt: new Date(Date.now() + 3600_000) });
    expect(await loadAccountToken("acc", { forceRefresh: true })).toBe("AT-novo");
  });

  it("invalid_grant marca a conta como reconnect e relança", async () => {
    state.secret = secret(null);
    refresh.mockRejectedValueOnce(new GmailAuthError("invalid_grant"));
    await expect(loadAccountToken("acc")).rejects.toBeInstanceOf(GmailAuthError);
    expect(state.updates).toEqual([{ table: "email_accounts", values: { status: "reconnect", last_error: "invalid_grant" } }]);
  });

  it("sem configuração lança erro claro", async () => {
    vi.stubEnv("GMAIL_TOKEN_KEY", "");
    await expect(loadAccountToken("acc")).rejects.toThrow(/não configurada/);
  });

  it("caixa sem segredos lança erro", async () => {
    await expect(loadAccountToken("acc")).rejects.toThrow(/sem tokens/);
  });
});

describe("markReconnect / clientForAccount", () => {
  it("limita a mensagem a 500 caracteres", async () => {
    await markReconnect("acc", "x".repeat(900));
    expect((state.updates[0].values.last_error as string).length).toBe(500);
  });
  it("clientForAccount devolve um GmailClient", () => {
    expect(clientForAccount("acc").getProfile).toBeTypeOf("function");
  });
});

describe("clientForAccount: token em memória", () => {
  const profile = () =>
    new Response(JSON.stringify({ emailAddress: "a@b.com", historyId: "1" }), { status: 200 });
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => profile());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const auth = (i: number) => ((fetchMock.mock.calls[i][1] as RequestInit).headers as Record<string, string>).Authorization;

  it("chamadas simultâneas renovam uma vez só e as seguintes usam a memória", async () => {
    state.secret = { refresh_token_enc: encryptToken("RT", KEY), access_token_enc: null, access_expires_at: null };
    refresh.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { accessToken: "AT-novo", expiresAt: new Date(Date.now() + 3600_000) };
    });
    const client = clientForAccount("acc");
    await Promise.all([client.getProfile(), client.getProfile(), client.getProfile()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(state.reads).toBe(1);
    await client.getProfile();
    expect(state.reads).toBe(1);
    expect(auth(3)).toBe("Bearer AT-novo");
  });

  it("renova de novo quando falta menos de 60 s", async () => {
    let now = Date.now();
    state.secret = {
      refresh_token_enc: encryptToken("RT", KEY),
      access_token_enc: encryptToken("AT-1", KEY),
      access_expires_at: new Date(now + 10 * 60_000).toISOString(),
    };
    const client = clientForAccount("acc", () => now);
    await client.getProfile();
    expect(state.reads).toBe(1);
    now += 9 * 60_000 + 30_000; // faltam 30 s
    refresh.mockResolvedValueOnce({ accessToken: "AT-2", expiresAt: new Date(now + 3600_000) });
    // no banco também está perto de vencer (o banco confere com o relógio real)
    state.secret = { ...(state.secret as object), access_expires_at: new Date(Date.now() + 10_000).toISOString() };
    await client.getProfile();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(auth(1)).toBe("Bearer AT-2");
  });

  it("401 em várias chamadas ao mesmo tempo renova uma vez", async () => {
    state.secret = {
      refresh_token_enc: encryptToken("RT", KEY),
      access_token_enc: encryptToken("AT-velho", KEY),
      access_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) =>
      (init.headers as Record<string, string>).Authorization === "Bearer AT-velho"
        ? new Response(JSON.stringify({ error: {} }), { status: 401 })
        : profile(),
    );
    refresh.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { accessToken: "AT-novo", expiresAt: new Date(Date.now() + 3600_000) };
    });
    const client = clientForAccount("acc");
    const r = await Promise.all([client.getProfile(), client.getProfile(), client.getProfile()]);
    expect(r.every((p) => p.emailAddress === "a@b.com")).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
