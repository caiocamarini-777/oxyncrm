import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const markReconnect = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./accounts", () => ({ clientForAccount: vi.fn(), markReconnect }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailAuthError, GmailRateLimitError } from "./client";
import { runGmailSync } from "./run";
import type { SyncClient } from "./sync";

const row = (id: string) => ({
  id,
  company_id: "co",
  email: `${id}@oxyn.com`,
  history_id: "1",
  backfill_page_token: null,
  backfill_done: true,
  last_synced_at: "2026-11-04T10:00:00Z",
});

function fakeDb(accounts: ReturnType<typeof row>[], claimOk = true) {
  const updates: { id: unknown; values: unknown }[] = [];
  return {
    updates,
    db: {
      from(table: string) {
        let values: unknown;
        const chain: Record<string, unknown> = {};
        for (const op of ["select", "eq", "is", "order", "limit"]) chain[op] = () => chain;
        chain.update = (v: unknown) => ((values = v), chain);
        // listagem (await no fim da cadeia) e reivindicação (.select após .update) usam o mesmo `then`
        chain.then = (resolve: (v: unknown) => void) => {
          if (values !== undefined) {
            updates.push({ id: table, values });
            return resolve({ data: claimOk ? [{ id: "x" }] : [], error: null });
          }
          return resolve({ data: accounts, error: null });
        };
        return chain;
      },
    } as unknown as SupabaseClient,
  };
}

/** Cliente cuja listagem de histórico falha com o erro dado (ou funciona sem novidades). */
const clientWith = (err: Error | null): SyncClient =>
  ({
    getProfile: async () => ({ emailAddress: "", historyId: "1" }),
    listMessages: async () => ({ messages: [] }),
    getMessage: async () => {
      throw new Error("não usado");
    },
    getThread: async () => {
      throw new Error("não usado");
    },
    listHistory: async () => {
      if (err) throw err;
      return { history: [], historyId: "2" };
    },
  }) as SyncClient;

beforeEach(() => markReconnect.mockClear());

describe("runGmailSync", () => {
  it("invalid_grant numa caixa marca reconnect e as outras seguem", async () => {
    const { db } = fakeDb([row("a"), row("b"), row("c")]);
    const errors: Record<string, Error | null> = { a: null, b: new GmailAuthError("invalid_grant"), c: new GmailRateLimitError() };
    const out = await runGmailSync(db, { budgetMs: 240_000, clientFor: (id) => clientWith(errors[id]) });

    expect(out.map((o) => [o.account, o.status])).toEqual([["a", "ok"], ["b", "reconnect"], ["c", "rate_limited"]]);
    expect(markReconnect).toHaveBeenCalledTimes(1);
    expect(markReconnect).toHaveBeenCalledWith("b", "invalid_grant");
  });

  it("erro inesperado vira status error e não derruba as demais", async () => {
    const { db } = fakeDb([row("a"), row("b")]);
    const errors: Record<string, Error | null> = { a: new Error("rede"), b: null };
    const out = await runGmailSync(db, { budgetMs: 240_000, clientFor: (id) => clientWith(errors[id]) });
    expect(out.map((o) => o.status)).toEqual(["error", "ok"]);
  });

  it("caixa já reivindicada por outra execução é pulada", async () => {
    const { db } = fakeDb([row("a")], false);
    const out = await runGmailSync(db, { budgetMs: 240_000, clientFor: () => clientWith(null) });
    expect(out).toEqual([{ account: "a", email: "a@oxyn.com", status: "busy" }]);
  });

  it("sem orçamento, não começa caixa nova", async () => {
    const { db } = fakeDb([row("a")]);
    const out = await runGmailSync(db, { budgetMs: 0, clientFor: () => clientWith(null) });
    expect(out).toEqual([]);
  });
});
