import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { RecordEntity } from "@/lib/records/types";
import { clientForAccount } from "./accounts";
import { GmailAuthError, GmailRateLimitError, type GmailThread } from "./client";
import { LIVE_CONCURRENCY, LIVE_PAGE_SIZE, effectiveQuery, mapLimit, summarizeThread, type LiveThreadSummary } from "./live-thread";

// Leitura ao vivo do Gmail para o módulo E-mail (nada disso é gravado).

export type Mailbox = {
  id: string;
  email: string;
  status: "active" | "reconnect";
  visibility: "shared" | "private";
  scopes: string[];
};

const MAILBOX_COLUMNS = "id, email, status, visibility, scopes";

/**
 * Caixas do usuário na empresa. O admin geral também lê as caixas dos outros pela RLS,
 * então o filtro por `user_id` é o que garante "minhas caixas".
 */
export async function listMyMailboxes(userId: string, companyId: string): Promise<Mailbox[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select(MAILBOX_COLUMNS)
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[email] caixas:", error.code, error.message);
    throw new Error("Falha ao carregar as caixas de e-mail.");
  }
  return (data ?? []) as Mailbox[];
}

export type LiveError = "reconnect" | "rate_limit" | "unknown";

/** Erro do Gmail -> o que a tela mostra. Nunca devolve a mensagem crua. */
export function classifyGmailError(e: unknown): LiveError {
  if (e instanceof GmailAuthError) return "reconnect";
  if (e instanceof GmailRateLimitError) return "rate_limit";
  console.error("[email] Gmail:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  return "unknown";
}

export const LIVE_ERROR_TEXT: Record<LiveError, string> = {
  reconnect: "O Gmail recusou o acesso desta caixa. Reconecte-a no seu perfil.",
  rate_limit: "O Gmail atingiu o limite de uso. Tente de novo em alguns instantes.",
  unknown: "Não foi possível falar com o Gmail agora. Tente de novo em instantes.",
};

export type LiveRow = LiveThreadSummary & { linked: boolean };
export type LivePage = { ok: true; rows: LiveRow[]; nextPageToken: string | null } | { ok: false; error: LiveError };

/** Conversas (com vínculo ativo no CRM) entre as ids do Gmail dadas. */
async function linkedGmailThreads(accountId: string, gmailIds: string[]): Promise<Set<string>> {
  if (gmailIds.length === 0) return new Set();
  const supabase = await createServerClient();
  const threads = await supabase.from("email_threads").select("id, gmail_thread_id").eq("account_id", accountId).in("gmail_thread_id", gmailIds);
  if (threads.error || !threads.data?.length) return new Set();
  const byId = new Map(threads.data.map((t: { id: string; gmail_thread_id: string }) => [t.id, t.gmail_thread_id]));
  const links = await supabase.from("email_links").select("thread_id").in("thread_id", [...byId.keys()]).is("unlinked_at", null);
  if (links.error) return new Set();
  return new Set((links.data ?? []).map((l: { thread_id: string }) => byId.get(l.thread_id)!).filter(Boolean));
}

/**
 * Uma página da caixa: `threads.list` (25) e `threads.get` em metadata, no máximo 5 por vez.
 * Falha de uma conversa isolada (por exemplo apagada entre a listagem e a leitura) cai no trecho
 * da listagem; falha de autorização ou de limite interrompe a página inteira.
 */
export async function loadLivePage(account: Mailbox, q: string, pageToken: string | null): Promise<LivePage> {
  try {
    const client = clientForAccount(account.id);
    const listed = await client.listThreads({ q: effectiveQuery(q), pageToken: pageToken ?? undefined, maxResults: LIVE_PAGE_SIZE });
    const summaries = await mapLimit(listed.threads, LIVE_CONCURRENCY, async (t) => {
      let thread: GmailThread | null = null;
      try {
        thread = await client.getThread(t.id, "metadata");
      } catch (e) {
        if (e instanceof GmailAuthError || e instanceof GmailRateLimitError) throw e;
      }
      return summarizeThread(t.id, thread, account.email, t.snippet ?? "");
    });
    const linked = await linkedGmailThreads(account.id, summaries.map((s) => s.gmailThreadId));
    return {
      ok: true,
      rows: summaries.map((s) => ({ ...s, linked: linked.has(s.gmailThreadId) })),
      nextPageToken: listed.nextPageToken ?? null,
    };
  } catch (e) {
    return { ok: false, error: classifyGmailError(e) };
  }
}

export type ThreadLinkView = { linkId: string; entity: RecordEntity; recordId: string; title: string };

const TITLE_COLUMN: Record<RecordEntity, { table: string; column: string }> = {
  leads: { table: "leads", column: "title" },
  deals: { table: "deals", column: "title" },
  persons: { table: "persons", column: "full_name" },
  organizations: { table: "organizations", column: "name" },
};

/**
 * Vínculos ativos da conversa já salva no CRM (vazio se ainda não foi salva), com o título de cada
 * registro. Pelo cliente do usuário: a RLS esconde o que ele não pode ler.
 */
export async function getThreadLinks(accountId: string, gmailThreadId: string): Promise<ThreadLinkView[]> {
  const supabase = await createServerClient();
  const thread = await supabase
    .from("email_threads")
    .select("id")
    .eq("account_id", accountId)
    .eq("gmail_thread_id", gmailThreadId)
    .maybeSingle();
  if (thread.error || !thread.data) return [];
  const links = await supabase
    .from("email_links")
    .select("id, entity, record_id")
    .eq("thread_id", thread.data.id)
    .is("unlinked_at", null)
    .order("created_at", { ascending: true });
  if (links.error) return [];
  const rows = (links.data ?? []) as { id: string; entity: RecordEntity; record_id: string }[];

  const out: ThreadLinkView[] = [];
  await Promise.all(
    rows.map(async (l) => {
      const spec = TITLE_COLUMN[l.entity];
      if (!spec) return;
      const { data } = await supabase.from(spec.table).select(spec.column).eq("id", l.record_id).is("deleted_at", null).maybeSingle();
      const title = data ? String((data as unknown as Record<string, unknown>)[spec.column] ?? "") : "";
      if (title) out.push({ linkId: l.id, entity: l.entity, recordId: l.record_id, title });
    }),
  );
  const order = new Map(rows.map((l, i) => [l.id, i]));
  return out.sort((a, b) => order.get(a.linkId)! - order.get(b.linkId)!);
}

/**
 * E-mails que já são contato (`persons.emails`) da empresa. A busca é em minúsculo (o trigger
 * `normalize_person_contacts` grava os e-mails das pessoas em minúsculo); o conjunto devolvido traz
 * o e-mail em minúsculo e também como veio, para quem consulta com qualquer caixa.
 */
export async function knownPersonEmails(companyId: string, emails: string[]): Promise<Set<string>> {
  const supabase = await createServerClient();
  const known = new Set<string>();
  const byLower = new Map<string, string[]>();
  for (const e of emails) {
    const lower = e.trim().toLowerCase();
    if (!lower) continue;
    byLower.set(lower, [...(byLower.get(lower) ?? []), e]);
  }
  await Promise.all(
    [...byLower.entries()].slice(0, 20).map(async ([lower, originals]) => {
      const { data, error } = await supabase
        .from("persons")
        .select("id")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .contains("emails", JSON.stringify([{ value: lower }]))
        .limit(1);
      if (!error && data && data.length > 0) {
        known.add(lower);
        for (const o of originals) known.add(o);
      }
    }),
  );
  return known;
}
