import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const markReconnect = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./accounts", () => ({ clientForAccount: vi.fn(), markReconnect }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { GmailAuthError, GmailRateLimitError } from "./client";
import { runGmailSync } from "./run";
import type { SyncClient } from "./sync";

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id: "u1",
  company_id: "co",
  email: `${id}@oxyn.com`,
  history_id: "1",
  backfill_page_token: null,
  backfill_done: true,
  sync_failures: {},
  last_synced_at: "2026-11-04T10:00:00Z",
  ...over,
});

type Tables = {
  profiles?: { id: string; active: boolean; is_super_admin: boolean }[];
  memberships?: { user_id: string; company_id: string }[];
  companies?: { id: string; archived_at: string | null }[];
};

/**
 * Banco falso: a listagem de caixas, os donos (perfis, vínculos, empresas) e as atualizações. O lease
 * (`update` com `.or(...)`) é aceito conforme `claimOk`; cada update fica registrado com os filtros.
 */
function fakeDb(accounts: ReturnType<typeof row>[], claimOk = true, tables: Tables = {}) {
  const updates: { table: string; values: Record<string, unknown>; filters: string[] }[] = [];
  const data: Record<string, unknown[]> = {
    email_accounts: accounts,
    profiles: tables.profiles ?? [{ id: "u1", active: true, is_super_admin: false }],
    memberships: tables.memberships ?? [{ user_id: "u1", company_id: "co" }],
    companies: tables.companies ?? [{ id: "co", archived_at: null }],
  };
  return {
    updates,
    db: {
      from(table: string) {
        let values: Record<string, unknown> | undefined;
        const filters: string[] = [];
        const chain: Record<string, unknown> = {};
        for (const op of ["select", "order", "limit", "in", "is"]) chain[op] = () => chain;
        chain.eq = (c: string, v: unknown) => (filters.push(`${c}=${String(v)}`), chain);
        chain.or = (f: string) => (filters.push(`or:${f}`), chain);
        chain.update = (v: Record<string, unknown>) => ((values = v), chain);
        chain.then = (resolve: (v: unknown) => void) => {
          if (values !== undefined) {
            updates.push({ table, values, filters });
            const isClaim = filters.some((f) => f.startsWith("or:"));
            return resolve({ data: isClaim && !claimOk ? [] : [{ id: "x" }], error: null });
          }
          return resolve({ data: data[table] ?? [], error: null });
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

  it("lease: reivindica com sync_lock_until e solta só o próprio no fim; last_synced_at não muda na reivindicação", async () => {
    const { db, updates } = fakeDb([row("a")]);
    const out = await runGmailSync(db, { budgetMs: 240_000, clientFor: () => clientWith(null), now: () => Date.parse("2026-11-04T12:00:00Z") });
    expect(out[0].status).toBe("ok");
    const claim = updates.find((u) => u.filters.some((f) => f.startsWith("or:")))!;
    expect(claim.values).toEqual({ sync_lock_until: "2026-11-04T12:05:00.000Z" });
    expect(claim.filters).toContain('or:sync_lock_until.is.null,sync_lock_until.lt."2026-11-04T12:00:00.000Z"');
    const release = updates.at(-1)!;
    expect(release.values).toEqual({ sync_lock_until: null });
    expect(release.filters).toContain("sync_lock_until=2026-11-04T12:05:00.000Z");
    const synced = updates.filter((u) => "last_synced_at" in u.values);
    expect(synced).toHaveLength(1); // só o fim da sincronização
    expect(updates.indexOf(synced[0])).toBeGreaterThan(updates.indexOf(claim));
  });

  it("solta o lease mesmo quando a caixa falha", async () => {
    const { db, updates } = fakeDb([row("a")]);
    await runGmailSync(db, { budgetMs: 240_000, clientFor: () => clientWith(new Error("rede")) });
    expect(updates.at(-1)!.values).toEqual({ sync_lock_until: null });
  });

  it.each([
    ["dono inativo", { profiles: [{ id: "u1", active: false, is_super_admin: false }] }],
    ["dono sem vínculo com a empresa", { memberships: [{ user_id: "u1", company_id: "outra" }] }],
    ["empresa arquivada", { companies: [{ id: "co", archived_at: "2026-11-01T00:00:00Z" }] }],
  ])("%s: não sincroniza e marca reconnect", async (_name, tables) => {
    const { db, updates } = fakeDb([row("a")], true, tables);
    const out = await runGmailSync(db, { budgetMs: 240_000, clientFor: () => clientWith(null) });
    expect(out).toEqual([{ account: "a", email: "a@oxyn.com", status: "reconnect", error: "Dono sem acesso à empresa" }]);
    expect(markReconnect).toHaveBeenCalledWith("a", "Dono sem acesso à empresa");
    expect(updates).toHaveLength(0); // nem reivindica
  });

  it("admin geral sem vínculo continua sincronizando", async () => {
    const { db } = fakeDb([row("a")], true, { profiles: [{ id: "u1", active: true, is_super_admin: true }], memberships: [] });
    const out = await runGmailSync(db, { budgetMs: 240_000, clientFor: () => clientWith(null) });
    expect(out[0].status).toBe("ok");
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
