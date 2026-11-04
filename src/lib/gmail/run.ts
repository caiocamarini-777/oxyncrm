import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientForAccount, markReconnect } from "./accounts";
import { GmailAuthError, GmailRateLimitError } from "./client";
import { loadContactIndex } from "./index-loader";
import type { ContactIndex } from "./matcher";
import { createSyncStore, type SyncStore } from "./store";
import { type SyncClient, type SyncResult, syncAccount } from "./sync";
import type { SyncAccount } from "./sync-core";

type AccountRow = SyncAccount & { last_synced_at: string | null };

export type AccountOutcome =
  | ({ account: string; email: string; status: "ok" } & SyncResult)
  | { account: string; email: string; status: "reconnect" | "rate_limited" | "error" | "busy"; error?: string };

export type RunOptions = {
  /** Orçamento total da execução, em ms. */
  budgetMs: number;
  /** Cliente do Gmail por caixa (injetável nos testes). */
  clientFor?: (accountId: string) => SyncClient;
  now?: () => number;
};

const MIN_SLICE_MS = 30_000;
const ACCOUNT_COLUMNS = "id, company_id, email, history_id, backfill_page_token, backfill_done, last_synced_at";

/**
 * Sincroniza as caixas `active`, das sincronizadas há mais tempo (ou nunca) para as mais recentes, uma de
 * cada vez. Cada caixa recebe uma fatia igual do tempo que resta, para uma primeira carga grande não
 * deixar as outras sem vez. A falha de uma caixa (token revogado, limite, erro) não interrompe as demais.
 */
export async function runGmailSync(db: SupabaseClient, opts: RunOptions): Promise<AccountOutcome[]> {
  const now = opts.now ?? Date.now;
  const clientFor = opts.clientFor ?? clientForAccount;
  const end = now() + opts.budgetMs;
  const store: SyncStore = createSyncStore(db);

  const { data, error } = await db
    .from("email_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("status", "active")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(200);
  if (error) throw new Error(`Falha ao listar as caixas: ${error.message}`);
  const accounts = (data ?? []) as AccountRow[];

  // Um índice por empresa, compartilhado pelas caixas dela nesta execução.
  const indexes = new Map<string, Promise<ContactIndex>>();
  const indexFor = (companyId: string) => {
    let p = indexes.get(companyId);
    if (!p) {
      p = loadContactIndex(db, companyId);
      p.catch(() => indexes.delete(companyId)); // falha não fica em cache
      indexes.set(companyId, p);
    }
    return p;
  };

  const outcomes: AccountOutcome[] = [];
  for (const [i, acc] of accounts.entries()) {
    const remaining = end - now();
    if (remaining <= 0) break; // as demais entram na próxima execução
    const id = { account: acc.id, email: acc.email };

    // Reivindica a caixa: duas execuções sobrepostas não sincronizam a mesma caixa ao mesmo tempo.
    let claim = db.from("email_accounts").update({ last_synced_at: new Date(now()).toISOString() }).eq("id", acc.id);
    claim = acc.last_synced_at === null ? claim.is("last_synced_at", null) : claim.eq("last_synced_at", acc.last_synced_at);
    const claimed = await claim.select("id");
    if (claimed.error || !claimed.data?.length) {
      outcomes.push({ ...id, status: "busy" });
      continue;
    }

    const slice = Math.max(MIN_SLICE_MS, remaining / (accounts.length - i));
    try {
      const result = await syncAccount(acc, {
        client: clientFor(acc.id),
        store,
        loadIndex: () => indexFor(acc.company_id),
        deadline: Math.min(end, now() + slice),
        now,
      });
      outcomes.push({ ...id, status: "ok", ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro";
      if (e instanceof GmailAuthError) {
        await markReconnect(acc.id, msg);
        outcomes.push({ ...id, status: "reconnect", error: msg });
      } else if (e instanceof GmailRateLimitError) {
        outcomes.push({ ...id, status: "rate_limited" });
      } else {
        console.error("gmail: falha ao sincronizar a caixa", acc.id, msg);
        await store.updateAccount(acc.id, { last_error: msg.slice(0, 500) }).catch(() => {});
        outcomes.push({ ...id, status: "error", error: msg });
      }
    }
  }
  return outcomes;
}
