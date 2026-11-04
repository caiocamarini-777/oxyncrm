import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientForAccount, markReconnect } from "./accounts";
import { GmailAuthError, GmailRateLimitError } from "./client";
import { loadContactIndex } from "./index-loader";
import type { ContactIndex } from "./matcher";
import { createSyncStore, type SyncStore } from "./store";
import { type SyncClient, type SyncResult, syncAccount } from "./sync";
import type { SyncAccount } from "./sync-core";

type AccountRow = SyncAccount & { user_id: string; last_synced_at: string | null };

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
/** Duração do lease de uma caixa: o `maxDuration` da rota do cron. Execução que morre solta a caixa sozinha. */
export const LEASE_MS = 300_000;
export const OWNER_WITHOUT_ACCESS = "Dono sem acesso à empresa";
const ACCOUNT_COLUMNS =
  "id, user_id, company_id, email, history_id, backfill_page_token, backfill_done, sync_failures, last_synced_at";

/**
 * Pares `usuário:empresa` cujo dono ainda pode usar a caixa: perfil ativo e admin geral, ou com vínculo
 * (`memberships`) numa empresa não arquivada. A mesma regra de `has_company_access`.
 */
async function ownersWithAccess(db: SupabaseClient, accounts: AccountRow[]): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (accounts.length === 0) return allowed;
  const userIds = [...new Set(accounts.map((a) => a.user_id))];
  const companyIds = [...new Set(accounts.map((a) => a.company_id))];
  const [profiles, members, companies] = await Promise.all([
    db.from("profiles").select("id, active, is_super_admin").in("id", userIds),
    db.from("memberships").select("user_id, company_id").in("user_id", userIds),
    db.from("companies").select("id, archived_at").in("id", companyIds),
  ]);
  const err = profiles.error ?? members.error ?? companies.error;
  if (err) throw new Error(`Falha ao conferir o acesso dos donos das caixas: ${err.message}`);

  const profileOf = new Map(
    ((profiles.data ?? []) as { id: string; active: boolean; is_super_admin: boolean }[]).map((p) => [p.id, p]),
  );
  const archived = new Set(
    ((companies.data ?? []) as { id: string; archived_at: string | null }[]).filter((c) => c.archived_at).map((c) => c.id),
  );
  const memberOf = new Set(
    ((members.data ?? []) as { user_id: string; company_id: string }[]).map((m) => `${m.user_id}:${m.company_id}`),
  );
  for (const a of accounts) {
    const p = profileOf.get(a.user_id);
    if (!p?.active) continue;
    const key = `${a.user_id}:${a.company_id}`;
    if (p.is_super_admin || (memberOf.has(key) && !archived.has(a.company_id))) allowed.add(key);
  }
  return allowed;
}

/**
 * Sincroniza as caixas `active`, das sincronizadas há mais tempo (ou nunca) para as mais recentes, uma de
 * cada vez. Cada caixa recebe uma fatia igual do tempo que resta, para uma primeira carga grande não
 * deixar as outras sem vez. A falha de uma caixa (token revogado, limite, erro) não interrompe as demais.
 *
 * - Caixa cujo dono ficou inativo ou perdeu o acesso à empresa não sincroniza: vira `reconnect`.
 * - Sobreposição: cada caixa é reivindicada com um lease (`sync_lock_until`), solto no fim.
 * - `last_synced_at` é a última sincronização concluída (gravada pelo `syncAccount`), não o início.
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
  const allowed = await ownersWithAccess(db, accounts);

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

    if (!allowed.has(`${acc.user_id}:${acc.company_id}`)) {
      await markReconnect(acc.id, OWNER_WITHOUT_ACCESS);
      outcomes.push({ ...id, status: "reconnect", error: OWNER_WITHOUT_ACCESS });
      continue;
    }

    // Lease: só pega a caixa se ninguém a segura (ou se o lease anterior venceu).
    const leaseUntil = new Date(now() + LEASE_MS).toISOString();
    const claimed = await db
      .from("email_accounts")
      .update({ sync_lock_until: leaseUntil })
      .eq("id", acc.id)
      .eq("status", "active")
      .or(`sync_lock_until.is.null,sync_lock_until.lt."${new Date(now()).toISOString()}"`)
      .select("id");
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
    } finally {
      // Solta só o próprio lease (se venceu e outra execução pegou a caixa, o dela fica).
      const released = await db
        .from("email_accounts")
        .update({ sync_lock_until: null })
        .eq("id", acc.id)
        .eq("sync_lock_until", leaseUntil);
      if (released.error) console.error("gmail: falha ao soltar a caixa", acc.id, released.error.message);
    }
  }
  return outcomes;
}
