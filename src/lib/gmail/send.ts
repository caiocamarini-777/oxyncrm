"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import type { RecordEntity } from "@/lib/records/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { clientForAccount } from "./accounts";
import { GmailApiError, GmailAuthError, GmailRateLimitError } from "./client";
import {
  bodyToHtml,
  headerOf,
  normalizeBody,
  replyHeaders,
  replySubject,
  sendEmailSchema,
  type SendEmailInput,
} from "./compose";
import { linkThreadToRecord } from "./link-actions";
import { LIVE_ERROR_TEXT } from "./live";
import { gmailConfig } from "./oauth";
import { buildMime, toBase64Url } from "./mime";
import { parseGmailMessage } from "./parse";
import { storeMessage, threadIsStored } from "./store";
import type { SyncAccount } from "./sync-core";

const DENIED = { ok: false, error: "Você não tem permissão para esta ação." } as const;

export type SendEmailResult = { threadId: string | null; warning: string | null };

/** Erro do Gmail no envio -> texto amigável. Nunca devolve a mensagem crua. */
function sendErrorText(e: unknown): string {
  if (e instanceof GmailAuthError) return LIVE_ERROR_TEXT.reconnect;
  if (e instanceof GmailRateLimitError) return LIVE_ERROR_TEXT.rate_limit;
  console.error("[email] enviar:", e instanceof Error ? `${e.name}: ${e.message}` : e);
  if (e instanceof GmailApiError) {
    if (e.status === 403 && /insufficient|scope/i.test(e.message))
      return "Esta caixa não tem permissão para enviar e-mails. Reconecte-a no seu perfil e autorize o envio.";
    if (e.status === 400) return "O Gmail recusou a mensagem. Confira os destinatários e o conteúdo.";
  }
  return "Não foi possível enviar agora. Tente de novo em instantes.";
}

type MailboxRow = SyncAccount & { status: string };

/** Caixa do usuário atual (a RLS deixa o admin geral ler as dos outros, daí o filtro por dono). */
async function ownMailbox(accountId: string, userId: string): Promise<MailboxRow | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("email_accounts")
    .select("id, company_id, email, history_id, backfill_page_token, backfill_done, status")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as MailboxRow;
}

const TABLE: Record<RecordEntity, string> = { leads: "leads", deals: "deals", persons: "persons", organizations: "organizations" };
const ACTIVITY_LINK: Record<RecordEntity, string> = {
  leads: "lead_id",
  deals: "deal_id",
  persons: "person_id",
  organizations: "organization_id",
};

/** Empresa do registro (pelo cliente do usuário: a RLS esconde o que ele não lê). */
async function recordCompany(entity: RecordEntity, id: string): Promise<string | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from(TABLE[entity]).select("company_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error || !data) return null;
  return (data as { company_id: string }).company_id;
}

/** Cria a atividade concluída "E-mail: assunto" (tipo e canal "E-mail" da empresa). Pula se faltarem. */
async function createSentActivity(opts: {
  companyId: string;
  ownerId: string;
  subject: string;
  record: { entity: RecordEntity; id: string };
}): Promise<void> {
  const supabase = await createServerClient();
  const [type, channel] = await Promise.all([
    supabase.from("activity_types").select("id").eq("company_id", opts.companyId).eq("name", "E-mail").eq("active", true).maybeSingle(),
    supabase.from("activity_channels").select("id").eq("company_id", opts.companyId).eq("name", "E-mail").eq("active", true).maybeSingle(),
  ]);
  if (!type.data || !channel.data) return;
  const now = new Date().toISOString();
  const { error } = await supabase.from("activities").insert({
    company_id: opts.companyId,
    owner_id: opts.ownerId,
    type_id: (type.data as { id: string }).id,
    channel_id: (channel.data as { id: string }).id,
    subject: `E-mail: ${opts.subject.trim() || "(sem assunto)"}`.slice(0, 200),
    due_at: now,
    duration_minutes: 0,
    done: true,
    completed_at: now,
    [ACTIVITY_LINK[opts.record.entity]]: opts.record.id,
  });
  if (error) console.error("[email] atividade do e-mail enviado:", error.code, error.message);
}

/**
 * Envia um e-mail pela caixa do usuário (Gmail `messages.send`).
 *
 * Ordem: valida, confere dono da caixa e registro, envia e grava (service role):
 * - conversa já salva no CRM: grava só a mensagem enviada e vincula ao registro, se veio um, com o cliente
 *   do usuário (RPC `email_link_thread`);
 * - conversa ainda não salva, com registro: grava a conversa inteira e vincula (`linkThreadToRecord`), para
 *   não ficar só a resposta sem as mensagens anteriores;
 * - conversa ainda não salva, sem registro: não grava nada (a sincronização a salva se casar com um contato).
 * Depois do envio nada mais falha a ação: o e-mail já saiu, então problemas de gravação, vínculo ou
 * atividade viram `warning`.
 */
export async function sendEmail(input: SendEmailInput): Promise<ActionResult<SendEmailResult>> {
  const parsed = sendEmailSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue.path[0] ?? "body");
    return { ok: false, error: issue.message, fieldErrors: { [field]: issue.message } };
  }
  const d = parsed.data;
  const profile = await getCurrentProfile();
  if (!profile) return DENIED;
  if (!gmailConfig()) return { ok: false, error: "Integração com o Gmail ainda não configurada." };
  const account = await ownMailbox(d.accountId, profile.id);
  if (!account) return { ok: false, error: "Caixa não encontrada." };
  if (account.status === "reconnect") return { ok: false, error: LIVE_ERROR_TEXT.reconnect };

  const supabase = await createServerClient();
  if (d.record) {
    const company = await recordCompany(d.record.entity, d.record.id);
    if (!company) return { ok: false, error: "Registro não encontrado." };
    if (company !== account.company_id)
      return { ok: false, error: "A caixa e o registro precisam ser da mesma empresa." };
    const canEdit = await supabase.rpc("can_edit_record", { p_entity: d.record.entity, p_record_id: d.record.id });
    if (canEdit.error || canEdit.data !== true)
      return { ok: false, error: "Você não pode enviar e-mail a partir deste registro: ele precisa ser editável por você." };
  }

  const gmail = clientForAccount(account.id);
  let gmailThreadId = d.gmailThreadId;
  let subject = d.subject;
  let headers: { inReplyTo?: string; references?: string } = {};

  let sent: { id: string; threadId: string };
  try {
    if (d.replyToGmailMessageId) {
      const original = await gmail.getMessage(d.replyToGmailMessageId, "metadata");
      if (gmailThreadId && original.threadId !== gmailThreadId) return { ok: false, error: "Conversa inválida." };
      gmailThreadId = original.threadId;
      headers = replyHeaders({ messageId: headerOf(original, "Message-ID"), references: headerOf(original, "References") });
      subject = replySubject(subject.trim() || headerOf(original, "Subject"));
    }
    const text = normalizeBody(d.body);
    const raw = toBase64Url(
      buildMime({
        from: account.email,
        to: d.to,
        cc: d.cc,
        subject,
        text,
        html: bodyToHtml(d.body),
        ...headers,
      }),
    );
    sent = await gmail.send(raw, gmailThreadId);
  } catch (e) {
    return { ok: false, error: sendErrorText(e) };
  }

  const NOT_STORED = "O e-mail foi enviado, mas não foi possível registrá-lo no CRM agora. Ele entra na próxima sincronização.";
  const warnings: string[] = [];
  const admin = createAdminClient();
  const storedThreadId = async (): Promise<string | null> => {
    const stored = await admin
      .from("email_threads")
      .select("id")
      .eq("account_id", account.id)
      .eq("gmail_thread_id", sent.threadId)
      .maybeSingle();
    return (stored.data as { id: string } | null)?.id ?? null;
  };

  let threadId: string | null = null;
  let alreadyStored: boolean | null = null;
  try {
    alreadyStored = await threadIsStored(admin, account.id, sent.threadId);
  } catch (e) {
    console.error("[email] consultar conversa do e-mail enviado:", e instanceof Error ? e.message : e);
  }

  if (alreadyStored === null) {
    warnings.push(NOT_STORED);
  } else if (alreadyStored) {
    try {
      await storeMessage(admin, account, parseGmailMessage(await gmail.getMessage(sent.id, "full")), []);
      threadId = await storedThreadId();
    } catch (e) {
      console.error("[email] gravar e-mail enviado:", e instanceof Error ? e.message : e);
    }
    if (!threadId) warnings.push(NOT_STORED);
  } else if (d.record) {
    // Grava a conversa inteira (com a mensagem enviada) e cria o vínculo manual.
    const linked = await linkThreadToRecord(account.id, sent.threadId, d.record.entity, d.record.id);
    if (linked.ok) {
      threadId = linked.data.threadId;
    } else {
      // A conversa pode ter sido gravada e só o vínculo recusado.
      threadId = await storedThreadId().catch(() => null);
      warnings.push(threadId ? `O e-mail foi enviado, mas não foi vinculado ao registro: ${linked.error}` : NOT_STORED);
    }
  }

  // Só a conversa que já estava salva chega aqui sem vínculo tentado (`linkThreadToRecord` já vincula).
  if (threadId && d.record && alreadyStored) {
    // Resposta numa conversa já vinculada ao registro: a gravação basta (a RPC também reativaria vínculo desfeito).
    const existing = await supabase
      .from("email_links")
      .select("id")
      .eq("thread_id", threadId)
      .eq("entity", d.record.entity)
      .eq("record_id", d.record.id)
      .is("unlinked_at", null)
      .limit(1);
    if (existing.error || (existing.data ?? []).length === 0) {
      const { error } = await supabase.rpc("email_link_thread", {
        p_thread: threadId,
        p_entity: d.record.entity,
        p_record: d.record.id,
      });
      if (error) {
        console.error("[email] vincular e-mail enviado:", error.code, error.message);
        warnings.push(`O e-mail foi enviado, mas não foi vinculado ao registro: ${translateDbError(error)}`);
      }
    }
  }

  if (d.record) {
    const company = await supabase.from("companies").select("settings").eq("id", account.company_id).maybeSingle();
    const settings = (company.data as { settings: Record<string, unknown> | null } | null)?.settings;
    if (settings?.email_sent_as_activity === true) {
      await createSentActivity({ companyId: account.company_id, ownerId: profile.id, subject, record: d.record }).catch((e) =>
        console.error("[email] atividade do e-mail enviado:", e instanceof Error ? e.message : e),
      );
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { threadId, warning: warnings.length > 0 ? warnings.join(" ") : null } };
}
