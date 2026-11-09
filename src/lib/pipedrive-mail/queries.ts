import "server-only";
import { getCurrentProfile } from "@/lib/auth/session";
import type { RecordThread } from "@/lib/gmail/thread-view";
import type { RecordEntity } from "@/lib/records/types";
import { createServerClient } from "@/lib/supabase/server";
import {
  buildPipedriveThreads,
  toRecordFileView,
  type PipedriveAttachmentRow,
  type PipedriveEmailRow,
  type RecordFileRow,
  type RecordFileView,
} from "./view";

/**
 * Leituras dos e-mails e arquivos importados do Pipedrive para o card, pelo cliente do usuário: a RLS
 * (`can_read_pipedrive_email`, `can_read_record_file`) decide o que aparece.
 *
 * As tabelas podem ainda não existir no banco (migration não aplicada): as leituras falham em silêncio
 * (log e lista vazia), para a página do registro nunca quebrar por causa da importação.
 */

/** Máximo de e-mails importados por card (os mais recentes). */
const MAX_EMAILS = 500;
/** Máximo de arquivos por card (os mais recentes). */
const MAX_FILES = 500;
/** Ids de e-mail por pedido na busca dos anexos: a lista vai na URL do PostgREST. */
const ID_CHUNK = 100;
/** O PostgREST devolve no máximo 1.000 linhas por pedido: os anexos vêm em páginas. */
const PAGE = 1000;

/** Sem o corpo (`body_html`): ele é carregado ao abrir a mensagem (`getPipedriveEmailBody`). */
const EMAIL_COLUMNS = "id, pipedrive_thread_id, subject, from_email, from_name, to, cc, sent_at, snippet, rfc_message_id, direction";

type DbError = { message: string; code?: string };
type Supabase = Awaited<ReturnType<typeof createServerClient>>;

function logError(what: string, error: DbError): void {
  console.error(`[pipedrive-email] ${what}:`, error.code, error.message);
}

/** Anexos (linhas de `record_files` com `email_id`) dos e-mails dados. `null` se a leitura falhou. */
async function attachmentsOf(supabase: Supabase, emailIds: string[]): Promise<PipedriveAttachmentRow[] | null> {
  const chunks: string[][] = [];
  for (let i = 0; i < emailIds.length; i += ID_CHUNK) chunks.push(emailIds.slice(i, i + ID_CHUNK));

  const results = await Promise.all(
    chunks.map(async (ids) => {
      const out: PipedriveAttachmentRow[] = [];
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from("record_files")
          .select("id, email_id, filename")
          .in("email_id", ids)
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (error) {
          logError("anexos", error);
          return null;
        }
        const rows = (data ?? []) as PipedriveAttachmentRow[];
        out.push(...rows);
        if (rows.length < PAGE) return out;
      }
    }),
  );
  if (results.some((r) => r === null)) return null;
  return results.flatMap((r) => r ?? []);
}

/**
 * Conversas importadas do Pipedrive vinculadas ao registro (até 500 e-mails, os mais recentes), com os
 * anexos de cada mensagem. Junção no banco pelo vínculo, sem o corpo. Falha em silêncio (log e lista vazia).
 */
export async function getRecordPipedriveThreads(entity: RecordEntity, recordId: string): Promise<RecordThread[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase
      .from("pipedrive_emails")
      .select(`${EMAIL_COLUMNS}, pipedrive_email_links!inner(email_id)`)
      .eq("pipedrive_email_links.entity", entity)
      .eq("pipedrive_email_links.record_id", recordId)
      .order("sent_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_EMAILS);
    if (error) {
      logError("e-mails", error);
      return [];
    }
    const rows = (data ?? []) as unknown as PipedriveEmailRow[];
    if (rows.length === 0) return [];

    const files = await attachmentsOf(supabase, rows.map((r) => r.id));
    if (files === null) return [];
    // O vínculo não tem id próprio (chave: e-mail, entidade e registro); a conversa importada não é desvinculada.
    return buildPipedriveThreads(rows, files, (emailId) => `${entity}:${recordId}:${emailId}`);
  } catch (e) {
    console.error("[pipedrive-email] e-mails:", e);
    return [];
  }
}

/**
 * Arquivos do card (só os do registro, não os anexos de e-mail), mais recentes primeiro. Falha em silêncio
 * (log e lista vazia).
 */
export async function getRecordFiles(entity: RecordEntity, recordId: string): Promise<RecordFileView[]> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createServerClient();
  try {
    const { data, error } = await supabase
      .from("record_files")
      .select("id, filename, size, created_at, storage_path, remote_url")
      .eq("entity", entity)
      .eq("record_id", recordId)
      .is("email_id", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_FILES);
    if (error) {
      logError("arquivos", error);
      return [];
    }
    return ((data ?? []) as RecordFileRow[]).map(toRecordFileView);
  } catch (e) {
    console.error("[pipedrive-email] arquivos:", e);
    return [];
  }
}
