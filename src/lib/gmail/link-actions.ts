"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { getAccessibleCompanies } from "@/lib/companies/scope";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { createPerson } from "@/lib/persons/actions";
import { EMAIL_RE } from "@/lib/persons/schema";
import { RECORD_ENTITIES, type RecordEntity } from "@/lib/records/types";
import { searchRecords } from "@/lib/search/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { clientForAccount } from "./accounts";
import { classifyGmailError, LIVE_ERROR_TEXT } from "./live";
import { visibleMessages } from "./live-thread";
import { gmailConfig } from "./oauth";
import { parseGmailMessage } from "./parse";
import { storeMessage } from "./store";
import type { SyncAccount } from "./sync-core";

const uuid = z.string().uuid();
const entitySchema = z.enum(RECORD_ENTITIES);
const DENIED = { ok: false, error: "Você não tem permissão para esta ação." } as const;
const GENERIC = { ok: false, error: "Não foi possível vincular agora. Tente novamente." } as const;

/** Caixa do usuário atual (a RLS deixa o admin geral ler as dos outros, daí o filtro por dono). */
async function ownMailbox(accountId: string, userId: string): Promise<(SyncAccount & { status: string }) | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, company_id, email, history_id, backfill_page_token, backfill_done, status")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as SyncAccount & { status: string };
}

/**
 * Vincula uma conversa da caixa a um card.
 *
 * Ordem: lê a conversa inteira no Gmail, GRAVA as mensagens (service role, único que escreve em
 * `email_threads`/`email_messages`) e só então chama `email_link_thread` com o cliente do usuário, para
 * valerem as checagens da RPC (dono da caixa, `can_edit_record` e mesma empresa).
 * Se a RPC recusar, a conversa fica salva sem vínculo: só o dono a lê (RLS) e a sincronização passa a
 * acompanhar as respostas; nada aparece em card algum. Os vínculos automáticos do casador não são
 * gravados aqui; a sincronização os cria quando a conversa casar.
 */
export async function linkThreadToRecord(
  accountId: string,
  gmailThreadId: string,
  entity: RecordEntity,
  recordId: string,
): Promise<ActionResult<{ threadId: string }>> {
  if (
    !uuid.safeParse(accountId).success ||
    !uuid.safeParse(recordId).success ||
    !entitySchema.safeParse(entity).success ||
    typeof gmailThreadId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(gmailThreadId)
  )
    return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  if (!gmailConfig()) return { ok: false, error: "Integração com o Gmail ainda não configurada." };
  const account = await ownMailbox(accountId, profile.id);
  if (!account) return { ok: false, error: "Caixa não encontrada." };
  if (account.status === "reconnect") return { ok: false, error: LIVE_ERROR_TEXT.reconnect };

  // Evita gravar uma conversa à toa quando o usuário nem pode editar o registro (a mesma empresa a RPC confere).
  const supabase = await createServerClient();
  const canEdit = await supabase.rpc("can_edit_record", { p_entity: entity, p_record_id: recordId });
  if (canEdit.error || canEdit.data !== true)
    return { ok: false, error: "Você não pode vincular a conversa a este registro: ele precisa ser editável por você." };

  const messages = await (async () => {
    try {
      return visibleMessages((await clientForAccount(account.id).getThread(gmailThreadId, "full")).messages);
    } catch (e) {
      return classifyGmailError(e);
    }
  })();
  if (typeof messages === "string") return { ok: false, error: LIVE_ERROR_TEXT[messages] };
  if (messages.length === 0) return { ok: false, error: "Esta conversa não tem mensagens para vincular." };

  const admin = createAdminClient();
  try {
    // Em sequência: cada gravação atualiza `last_message_at` e o assunto da mesma conversa.
    for (const m of messages) await storeMessage(admin, account, parseGmailMessage(m), []);
  } catch (e) {
    console.error("[email] gravar conversa:", e instanceof Error ? e.message : e);
    return GENERIC;
  }

  const stored = await admin
    .from("email_threads")
    .select("id")
    .eq("account_id", account.id)
    .eq("gmail_thread_id", gmailThreadId)
    .maybeSingle();
  if (stored.error || !stored.data) {
    console.error("[email] ler conversa gravada:", stored.error?.message);
    return GENERIC;
  }
  const threadId = (stored.data as { id: string }).id;

  const { error } = await supabase.rpc("email_link_thread", { p_thread: threadId, p_entity: entity, p_record: recordId });
  if (error) {
    if (error.message.includes("OXYN_EMAIL_FORBIDDEN"))
      return { ok: false, error: "Você não pode vincular a conversa a este registro: ele precisa ser da mesma empresa da caixa e editável por você." };
    return { ok: false, error: translateDbError(error) };
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { threadId } };
}

/**
 * Cria a pessoa (e-mail e nome pré-preenchidos, na empresa da caixa) e vincula a conversa a ela.
 * Se a pessoa for criada e o vínculo falhar, devolve `ok` com `linkError` (a pessoa existe; criar de novo
 * duplicaria).
 */
export async function createPersonAndLink(
  accountId: string,
  gmailThreadId: string,
  name: string,
  email: string,
): Promise<ActionResult<{ personId: string; linkError: string | null }>> {
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Dados inválidos." };
  const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const cleanName = typeof name === "string" ? name.trim() : "";
  if (!cleanName) return { ok: false, error: "Informe o nome.", fieldErrors: { name: "Informe o nome." } };
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "E-mail inválido.", fieldErrors: { email: "E-mail inválido." } };
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const account = await ownMailbox(accountId, profile.id);
  if (!account) return { ok: false, error: "Caixa não encontrada." };

  const created = await createPerson(account.company_id, {
    fullName: cleanName,
    emails: [{ label: "Trabalho", value: cleanEmail }],
  });
  if (!created.ok) return created;

  const linked = await linkThreadToRecord(accountId, gmailThreadId, "persons", created.data.id);
  return { ok: true, data: { personId: created.data.id, linkError: linked.ok ? null : linked.error } };
}

export type LinkTarget = { entity: RecordEntity; id: string; title: string; subtitle: string | null };

/** Busca leads, negócios, pessoas e organizações da empresa (a RLS limita ao que o usuário enxerga). */
export async function searchLinkTargets(companyId: string, q: string): Promise<ActionResult<LinkTarget[]>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: "Dados inválidos." };
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  const company = (await getAccessibleCompanies()).find((c) => c.id === companyId);
  if (!company) return DENIED;
  const found = await searchRecords(q, { kind: "company", company });
  return { ok: true, data: found.map((r) => ({ entity: r.entity, id: r.id, title: r.title, subtitle: r.subtitle })) };
}
