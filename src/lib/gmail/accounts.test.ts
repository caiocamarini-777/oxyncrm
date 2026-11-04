import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Secret = { refresh_token_enc: string; access_token_enc: string | null; access_expires_at: string | null };
const state = vi.hoisted(() => ({
  secret: null as unknown,
  updates: [] as { table: string; values: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => ({ overrideTypes: async () => ({ data: state.secret, error: null }) }) }),
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
