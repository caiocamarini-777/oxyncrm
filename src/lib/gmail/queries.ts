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

/** Máximo de conversas por card (o limite de 1.000 linhas do PostgREST também vale para as mensagens). */
const MAX_THREADS = 100;

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

  const links = await supabase
    .from("email_links")
    .select("id, thread_id")
    .eq("entity", entity)
    .eq("record_id", recordId)
    .is("unlinked_at", null);
  if (links.error) fail("vínculos", links.error);
  const linkRows = (links.data ?? []) as LinkRow[];
  if (linkRows.length === 0) return [];
  const threadIds = linkRows.map((l) => l.thread_id);

  const [threads, messages, mine, canEdit] = await Promise.all([
    supabase
      .from("email_threads")
      .select("id, account_id, gmail_thread_id, subject, last_message_at")
      .in("id", threadIds)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(MAX_THREADS),
    supabase
      .from("email_messages")
      .select(
        "id, thread_id, gmail_message_id, from_email, from_name, to, cc, sent_at, snippet, body_html, body_text, attachments, direction",
      )
      .in("thread_id", threadIds)
      .order("sent_at", { ascending: true }),
    // O admin geral também lê as caixas dos outros: o filtro por dono mantém "minha caixa".
    supabase.from("email_accounts").select("id, email").eq("user_id", profile.id),
    supabase.rpc("can_edit_record", { p_entity: entity, p_record_id: recordId }),
  ]);
  if (threads.error) fail("conversas", threads.error);
  if (messages.error) fail("mensagens", messages.error);
  if (mine.error) fail("caixas", mine.error);
  if (canEdit.error) fail("permissão", canEdit.error);

  return buildRecordThreads({
    threads: (threads.data ?? []) as ThreadRow[],
    messages: (messages.data ?? []) as MessageRow[],
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
  const links = await supabase
    .from("email_links")
    .select("thread_id")
    .eq("entity", entity)
    .eq("record_id", recordId)
    .is("unlinked_at", null);
  if (links.error) fail("vínculos", links.error);
  const threadIds = (links.data ?? []).map((l: { thread_id: string }) => l.thread_id);
  if (threadIds.length === 0) return [];

  const { data, error } = await supabase
    .from("email_messages")
    .select("direction, from_email, from_name, sent_at, thread:email_threads(subject)")
    .in("thread_id", threadIds)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) fail("mensagens", error);
  type Row = {
    direction: "in" | "out";
    from_email: string;
    from_name: string | null;
    sent_at: string;
    thread: { subject: string } | { subject: string }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((m) => {
    const t = Array.isArray(m.thread) ? m.thread[0] : m.thread;
    return {
      direction: m.direction,
      fromEmail: m.from_email,
      fromName: m.from_name,
      subject: t?.subject ?? "",
      sentAt: m.sent_at,
    };
  });
}
