import { z } from "zod";
import type { GmailMessage } from "./parse";

// Partes puras do envio de e-mail (sem rede nem banco, testáveis).

export const SUBJECT_MAX = 998;
export const BODY_MAX_BYTES = 100 * 1024;
export const MAX_RECIPIENTS = 50;

/** E-mail aceito no envio: sem espaço, aspas, vírgula, ponto e vírgula nem colchetes (nada que quebre o cabeçalho). */
export const SEND_EMAIL_RE = /^[^\s@<>,;"()[\]\\]+@[^\s@<>,;"()[\]\\]+\.[^\s@<>,;"()[\]\\]{2,}$/;

/** "a@b.com, c@d.com; e@f.com" -> lista sem vazios nem repetidos (ignora maiúsculas), na ordem digitada. */
export function parseEmailList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const email = part.trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

const emailField = z.string().trim().max(254, "E-mail muito longo.").regex(SEND_EMAIL_RE, "E-mail inválido.");

export const sendEmailSchema = z.object({
  accountId: z.string().uuid("Escolha a caixa."),
  to: z.array(emailField).min(1, "Informe ao menos um destinatário.").max(MAX_RECIPIENTS, "Destinatários demais."),
  cc: z.array(emailField).max(MAX_RECIPIENTS, "Destinatários demais.").default([]),
  subject: z.string().max(SUBJECT_MAX, `Use no máximo ${SUBJECT_MAX} caracteres no assunto.`),
  body: z
    .string()
    .min(1, "Escreva a mensagem.")
    .refine((v) => new TextEncoder().encode(v).length <= BODY_MAX_BYTES, "A mensagem passa do limite de 100 KB."),
  gmailThreadId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "Conversa inválida.")
    .optional(),
  replyToGmailMessageId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "Mensagem inválida.")
    .optional(),
  record: z
    .object({
      entity: z.enum(["leads", "deals", "persons", "organizations"]),
      id: z.string().uuid(),
    })
    .optional(),
});
export type SendEmailInput = z.input<typeof sendEmailSchema>;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Texto simples -> HTML: escapado, quebras de linha viram `<br>`, numa div com fonte sem serifa. */
export function bodyToHtml(text: string): string {
  const inner = escapeHtml(text.replace(/\r\n?/g, "\n")).replace(/\n/g, "<br>");
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px;">${inner}</div>`;
}

/** Texto do corpo com quebras CRLF normalizadas para LF (a parte text/plain). */
export function normalizeBody(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Põe "Re: " no assunto quando falta (reconhece Re:, RE: e Res:). */
export function replySubject(subject: string): string {
  const s = subject.trim();
  return /^(re|res)\s*:/i.test(s) ? s : `Re: ${s}`.trim();
}

/** Valor do cabeçalho (sem diferenciar maiúsculas) no nível principal da mensagem; "" se não houver. */
export function headerOf(msg: GmailMessage, name: string): string {
  const n = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value.trim() ?? "";
}

/** In-Reply-To e References da resposta: as References da original mais o Message-ID dela (sem repetir). */
export function replyHeaders(original: { messageId: string; references: string }): {
  inReplyTo?: string;
  references?: string;
} {
  const id = original.messageId.trim();
  if (!id) return {};
  const refs = original.references.split(/\s+/).filter(Boolean);
  if (!refs.includes(id)) refs.push(id);
  return { inReplyTo: id, references: refs.join(" ") };
}

export type ComposeVarsInput = {
  personName?: string | null;
  organizationName?: string | null;
  dealTitle?: string | null;
  userName?: string | null;
};

/** Variáveis dos modelos. O que não existe fica vazio. */
export function buildTemplateVars(i: ComposeVarsInput): Record<string, string> {
  const person = (i.personName ?? "").trim();
  return {
    "pessoa.nome": person,
    "pessoa.primeiro_nome": person.split(/\s+/)[0] ?? "",
    "organizacao.nome": (i.organizationName ?? "").trim(),
    "negocio.titulo": (i.dealTitle ?? "").trim(),
    "usuario.nome": (i.userName ?? "").trim(),
  };
}

/** Primeiro e-mail válido da lista de contato da pessoa (`persons.emails`). */
export function firstPersonEmail(emails: unknown): string | null {
  if (!Array.isArray(emails)) return null;
  for (const e of emails) {
    const v = e && typeof e === "object" ? (e as { value?: unknown }).value : null;
    if (typeof v === "string" && SEND_EMAIL_RE.test(v.trim())) return v.trim();
  }
  return null;
}

type ReplyMessage = {
  direction: "in" | "out";
  fromEmail: string;
  to: { email: string }[];
};

/** Para quem responder: o remetente da última mensagem recebida; sem recebidas, os destinatários da última enviada. */
export function replyRecipients(messages: ReplyMessage[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.direction === "in" && SEND_EMAIL_RE.test(m.fromEmail)) return [m.fromEmail];
  }
  const last = messages[messages.length - 1];
  return last ? last.to.map((a) => a.email).filter((e) => SEND_EMAIL_RE.test(e)).slice(0, 1) : [];
}

export type ComposeTemplate = { id: string; name: string; subject: string; body: string };
export type ComposeMailbox = { id: string; email: string };
export type ComposeData = {
  suggestedTo: string[];
  vars: Record<string, string>;
  templates: ComposeTemplate[];
  mailboxes: ComposeMailbox[];
};

/** Variáveis dos modelos mostradas na ajuda da página de configuração. */
export const TEMPLATE_VARIABLES: { key: string; description: string }[] = [
  { key: "pessoa.nome", description: "Nome completo da pessoa" },
  { key: "pessoa.primeiro_nome", description: "Primeiro nome da pessoa" },
  { key: "organizacao.nome", description: "Nome da organização" },
  { key: "negocio.titulo", description: "Título do negócio" },
  { key: "usuario.nome", description: "Seu nome" },
];
