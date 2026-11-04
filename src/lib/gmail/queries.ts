import "server-only";
import { getCurrentProfile } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import type { RecordEntity } from "@/lib/records/types";
import {
  buildRecordThreads,
  type LinkRow,
  type MessageRow,
  type RecordThread,
  type ThreadRow,
} from "./thread-view";

/** Máximo de conversas por card. */
const MAX_THREADS = 100;
/** O PostgREST devolve no máximo 1.000 linhas por pedido: as mensagens vêm em páginas. */
const MESSAGE_PAGE = 1000;
/** Teto de páginas de mensagens por card (5.000 mensagens; as mais recentes primeiro). */
const MAX_MESSAGE_PAGES = 5;

/** Só metadados e trecho: o corpo (`body_html`/`body_text`) é carregado ao abrir a mensagem. */
const MESSAGE_COLUMNS = "id, thread_id, gmail_message_id, from_email, from_name, to, cc, sent_at, snippet, attachments, direction";

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[email] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar os e-mails (${what}).`);
}

/**
 * Conversas vinculadas (vínculo ativo) ao registro, com as mensagens, pelo cliente do usuário.
 * A RLS decide o que aparece: caixa privada de outro usuário e card sem acesso não devolvem nada.
 *
 * `accountEmail`: `email_accounts` só é legível pelo dono, então o endereço da caixa vem dela quando
 * a caixa é do usuário atual e, para as caixas dos outros, do remetente da primeira mensagem enviada
 * (`direction = out`). Sem mensagem enviada, fica `null`.
 */
export async function getRecordThreads(entity: RecordEntity, recordId: string): Promise<RecordThread[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createServerClient();

  // Junção no banco: as conversas já vêm filtradas pelo vínculo ativo com o registro (sem lista de ids).
  const [threads, mine, canEdit] = await Promise.all([
    supabase
      .from("email_threads")
      .select("id, account_id, gmail_thread_id, subject, last_message_at, email_links!inner(id, thread_id)")
      .eq("email_links.entity", entity)
      .eq("email_links.record_id", recordId)
      .is("email_links.unlinked_at", null)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(MAX_THREADS),
    // O admin geral também lê as caixas dos outros: o filtro por dono mantém "minha caixa".
    supabase.from("email_accounts").select("id, email").eq("user_id", profile.id),
    supabase.rpc("can_edit_record", { p_entity: entity, p_record_id: recordId }),
  ]);
  if (threads.error) fail("conversas", threads.error);
  if (mine.error) fail("caixas", mine.error);
  if (canEdit.error) fail("permissão", canEdit.error);

  type ThreadWithLinks = ThreadRow & { email_links: LinkRow | LinkRow[] | null };
  const threadRows = (threads.data ?? []) as unknown as ThreadWithLinks[];
  if (threadRows.length === 0) return [];
  const linkRows: LinkRow[] = threadRows.flatMap((t) => (Array.isArray(t.email_links) ? t.email_links : t.email_links ? [t.email_links] : []));
  const threadIds = threadRows.map((t) => t.id);

  // Só as mensagens das conversas escolhidas, das mais recentes para as mais antigas, em páginas.
  const messageRows: MessageRow[] = [];
  for (let page = 0; page < MAX_MESSAGE_PAGES; page++) {
    const { data, error } = await supabase
      .from("email_messages")
      .select(MESSAGE_COLUMNS)
      .in("thread_id", threadIds)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * MESSAGE_PAGE, (page + 1) * MESSAGE_PAGE - 1);
    if (error) fail("mensagens", error);
    const rows = (data ?? []) as unknown as MessageRow[];
    messageRows.push(...rows);
    if (rows.length < MESSAGE_PAGE) break;
  }

  return buildRecordThreads({
    threads: threadRows,
    messages: messageRows,
    links: linkRows,
    mineAccounts: new Map((mine.data ?? []).map((a: { id: string; email: string }) => [a.id, a.email])),
    canEditRecord: canEdit.data === true,
  });
}

export type RecordEmailEvent = {
  direction: "in" | "out";
  fromEmail: string;
  fromName: string | null;
  subject: string;
  sentAt: string;
};

/** Mensagens das conversas vinculadas ao registro para a linha do tempo: as `limit` mais recentes. */
export async function getRecordEmailEvents(
  entity: RecordEntity,
  recordId: string,
  limit = 200,
): Promise<RecordEmailEvent[]> {
  const supabase = await createServerClient();
  // Junção no banco: só as mensagens de conversas com vínculo ativo ao registro.
  const { data, error } = await supabase
    .from("email_messages")
    .select("direction, from_email, from_name, sent_at, email_threads!inner(subject, email_links!inner(entity, record_id, unlinked_at))")
    .eq("email_threads.email_links.entity", entity)
    .eq("email_threads.email_links.record_id", recordId)
    .is("email_threads.email_links.unlinked_at", null)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) fail("mensagens", error);
  type Row = {
    direction: "in" | "out";
    from_email: string;
    from_name: string | null;
    sent_at: string;
    email_threads: { subject: string } | { subject: string }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((m) => {
    const t = Array.isArray(m.email_threads) ? m.email_threads[0] : m.email_threads;
    return {
      direction: m.direction,
      fromEmail: m.from_email,
      fromName: m.from_name,
      subject: t?.subject ?? "",
      sentAt: m.sent_at,
    };
  });
}
