import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailLinkTarget } from "./matcher";
import type { ParsedMessage } from "./parse";
import { buildMessageRow, clean, type SyncAccount, threadPatch } from "./sync-core";

/** Colunas de email_accounts que a sincronização altera. */
export type AccountPatch = Partial<{
  history_id: string | null;
  backfill_page_token: string | null;
  backfill_done: boolean;
  last_synced_at: string;
  last_error: string | null;
}>;

/** Acesso ao banco da sincronização (o `syncAccount` só enxerga esta interface). */
export interface SyncStore {
  updateAccount(accountId: string, patch: AccountPatch): Promise<void>;
  /** Ids (do Gmail) das mensagens já gravadas. */
  storedMessageIds(accountId: string, gmailMessageIds: string[]): Promise<Set<string>>;
  /** Ids (do Gmail) das conversas já gravadas. */
  storedThreadIds(accountId: string, gmailThreadIds: string[]): Promise<Set<string>>;
  /** Grava conversa, mensagem e vínculos automáticos. Idempotente. */
  storeMessage(account: SyncAccount, parsed: ParsedMessage, links: EmailLinkTarget[]): Promise<{ linksInserted: number }>;
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

export async function threadIsStored(db: SupabaseClient, accountId: string, gmailThreadId: string): Promise<boolean> {
  return (await storedThreads(db, accountId, [gmailThreadId])).has(gmailThreadId);
}

async function storedThreads(db: SupabaseClient, accountId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await db.from("email_threads").select("gmail_thread_id").eq("account_id", accountId).in("gmail_thread_id", ids);
  if (error) fail("Falha ao consultar conversas", error);
  return new Set((data ?? []).map((r: { gmail_thread_id: string }) => r.gmail_thread_id));
}

/**
 * Grava uma mensagem. Tudo é idempotente pelas chaves únicas:
 * - conversa: (account_id, gmail_thread_id), criada sem sobrescrever e depois ajustada por `threadPatch`;
 * - mensagem: (account_id, gmail_message_id), upsert;
 * - vínculo: (thread_id, entity, record_id), inserido com `ignoreDuplicates`, o que não toca na linha
 *   existente: um vínculo desfeito à mão (`unlinked_at`) continua desfeito.
 */
export async function storeMessage(
  db: SupabaseClient,
  account: SyncAccount,
  parsed: ParsedMessage,
  links: EmailLinkTarget[],
): Promise<{ linksInserted: number }> {
  const created = await db
    .from("email_threads")
    .upsert(
      { account_id: account.id, company_id: account.company_id, gmail_thread_id: parsed.threadId, subject: clean(parsed.subject) },
      { onConflict: "account_id,gmail_thread_id", ignoreDuplicates: true },
    );
  if (created.error) fail("Falha ao gravar a conversa", created.error);

  const found = await db
    .from("email_threads")
    .select("id, subject, last_message_at")
    .eq("account_id", account.id)
    .eq("gmail_thread_id", parsed.threadId)
    .single();
  if (found.error) fail("Falha ao ler a conversa", found.error);
  const thread = found.data as { id: string; subject: string; last_message_at: string | null };

  const msg = await db
    .from("email_messages")
    .upsert(buildMessageRow(account, thread.id, parsed), { onConflict: "account_id,gmail_message_id" });
  if (msg.error) fail("Falha ao gravar a mensagem", msg.error);

  const patch = threadPatch(thread, parsed);
  if (Object.keys(patch).length > 0) {
    const up = await db.from("email_threads").update(patch).eq("id", thread.id);
    if (up.error) fail("Falha ao atualizar a conversa", up.error);
  }

  if (links.length === 0) return { linksInserted: 0 };
  const ins = await db
    .from("email_links")
    .upsert(
      links.map((l) => ({ thread_id: thread.id, entity: l.entity, record_id: l.recordId, origin: "auto" })),
      { onConflict: "thread_id,entity,record_id", ignoreDuplicates: true },
    )
    .select("id");
  if (ins.error) fail("Falha ao gravar os vínculos", ins.error);
  return { linksInserted: ins.data?.length ?? 0 };
}

export function createSyncStore(db: SupabaseClient): SyncStore {
  return {
    async updateAccount(accountId, patch) {
      const { error } = await db.from("email_accounts").update(patch).eq("id", accountId);
      if (error) fail("Falha ao atualizar a caixa", error);
    },
    async storedMessageIds(accountId, ids) {
      if (ids.length === 0) return new Set();
      const { data, error } = await db.from("email_messages").select("gmail_message_id").eq("account_id", accountId).in("gmail_message_id", ids);
      if (error) fail("Falha ao consultar mensagens", error);
      return new Set((data ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id));
    },
    storedThreadIds: (accountId, ids) => storedThreads(db, accountId, ids),
    storeMessage: (account, parsed, links) => storeMessage(db, account, parsed, links),
  };
}
