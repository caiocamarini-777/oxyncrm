import { addresses, decodeSnippet, type RecordThread, type ThreadMessageView } from "@/lib/gmail/thread-view";

/**
 * Formas puras (sem acesso ao banco) dos e-mails e arquivos importados do Pipedrive, mostrados no card.
 * Os e-mails entram no histórico como `RecordThread` (`source: "pipedrive"`), no mesmo cartão do Gmail.
 */

/** Linha de `pipedrive_emails` sem o corpo (carregado ao abrir a mensagem). */
export type PipedriveEmailRow = {
  id: string;
  /** bigint: o PostgREST devolve número. */
  pipedrive_thread_id: number | string | null;
  subject: string;
  from_email: string;
  from_name: string | null;
  to: unknown;
  cc: unknown;
  sent_at: string;
  snippet: string;
  rfc_message_id: string | null;
  direction: "in" | "out";
};

/** Anexo de e-mail importado: linha de `record_files` com `email_id`. */
export type PipedriveAttachmentRow = { id: string; email_id: string | null; filename: string };

/** Linha de `record_files` de um arquivo do card. */
export type RecordFileRow = {
  id: string;
  filename: string;
  size: number | string | null;
  created_at: string;
  storage_path: string | null;
  remote_url: string | null;
};

export type RecordFileView = {
  id: string;
  filename: string;
  size: number | null;
  createdAt: string;
  /** Link externo (Google Drive etc.): abre em nova aba. */
  remote: boolean;
  /** false: grande demais para o bucket, só o nome foi gravado. */
  available: boolean;
};

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Agrupa os e-mails importados por conversa do Pipedrive (`pipedrive_thread_id`); e-mail sem conversa vira
 * uma conversa só dele. Mensagens em ordem de envio; conversas da mais recente para a mais antiga.
 * Os anexos vêm de `files` (linhas de `record_files` do e-mail). `linkIdFor` recebe o id da primeira mensagem.
 */
export function buildPipedriveThreads(
  rows: PipedriveEmailRow[],
  files: PipedriveAttachmentRow[],
  linkIdFor: (emailId: string) => string,
): RecordThread[] {
  const filesByEmail = new Map<string, { filename: string; fileId: string }[]>();
  for (const f of files) {
    if (!f.email_id) continue;
    const item = { filename: f.filename || "(sem nome)", fileId: f.id };
    const list = filesByEmail.get(f.email_id);
    if (list) list.push(item);
    else filesByEmail.set(f.email_id, [item]);
  }

  const groups = new Map<string, PipedriveEmailRow[]>();
  for (const r of rows) {
    const key = r.pipedrive_thread_id != null ? `pd-${r.pipedrive_thread_id}` : `pd-e-${r.id}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const out: RecordThread[] = [];
  for (const [threadId, group] of groups) {
    const sorted = group.slice().sort((a, b) => time(a.sent_at) - time(b.sent_at));
    const messages: ThreadMessageView[] = sorted.map((m) => ({
      id: m.id,
      gmailMessageId: "",
      fromEmail: m.from_email,
      fromName: m.from_name,
      to: addresses(m.to),
      cc: addresses(m.cc),
      sentAt: m.sent_at,
      snippet: decodeSnippet(m.snippet),
      rfcMessageId: m.rfc_message_id,
      attachments: filesByEmail.get(m.id) ?? [],
      direction: m.direction,
    }));
    out.push({
      threadId,
      source: "pipedrive",
      accountId: "",
      gmailThreadId: "",
      linkId: linkIdFor(sorted[0].id),
      subject: sorted.find((m) => m.subject.trim())?.subject ?? "",
      lastMessageAt: messages[messages.length - 1]?.sentAt ?? null,
      accountEmail: null,
      isMine: false,
      canUnlink: false,
      messages,
    });
  }
  return out.sort((a, b) => time(b.lastMessageAt) - time(a.lastMessageAt));
}

/** Message-ID comparável: sem espaços nem `<>`, em minúsculas (o Pipedrive e o Gmail podem diferir na forma). */
function messageKey(id: string | null): string | null {
  const k = id?.trim().replace(/^<|>$/g, "").trim().toLowerCase();
  return k || null;
}

/**
 * Tira das conversas importadas as mensagens que já aparecem pelo Gmail (mesmo Message-ID) e as repetidas entre
 * si (o mesmo e-mail guardado na caixa de dois vendedores: fica a primeira por data de envio), e as conversas
 * que ficarem vazias. A data da conversa passa a ser a da última mensagem que ficou.
 */
export function dropImportedDuplicates(gmail: RecordThread[], imported: RecordThread[]): RecordThread[] {
  const seen = new Set<string>();
  for (const t of gmail) {
    for (const m of t.messages) {
      const k = messageKey(m.rfcMessageId);
      if (k) seen.add(k);
    }
  }

  // Message-ID → a cópia importada que fica (a mais antiga; no empate, o menor id, para não depender da ordem).
  const keep = new Map<string, ThreadMessageView>();
  for (const t of imported) {
    for (const m of t.messages) {
      const k = messageKey(m.rfcMessageId);
      if (!k || seen.has(k)) continue;
      const cur = keep.get(k);
      if (!cur || time(m.sentAt) < time(cur.sentAt) || (time(m.sentAt) === time(cur.sentAt) && m.id < cur.id)) keep.set(k, m);
    }
  }

  const out: RecordThread[] = [];
  for (const t of imported) {
    const messages = t.messages.filter((m) => {
      const k = messageKey(m.rfcMessageId);
      return !k || keep.get(k) === m;
    });
    if (messages.length === 0) continue;
    if (messages.length === t.messages.length) out.push(t);
    else out.push({ ...t, messages, lastMessageAt: messages[messages.length - 1].sentAt });
  }
  return out.sort((a, b) => time(b.lastMessageAt) - time(a.lastMessageAt));
}

/**
 * Endereço que baixa ou abre um arquivo importado (do card ou anexo de e-mail): a rota confere o acesso e
 * redireciona para a URL assinada (ou para o link externo).
 */
export function recordFileHref(fileId: string): string {
  return `/api/arquivos/${encodeURIComponent(fileId)}`;
}

/** Arquivo do card para a tela: tamanho em número e se dá para baixar ou abrir. */
export function toRecordFileView(r: RecordFileRow): RecordFileView {
  const size = r.size == null ? null : Number(r.size);
  return {
    id: r.id,
    filename: r.filename || "(sem nome)",
    size: size !== null && Number.isFinite(size) ? size : null,
    createdAt: r.created_at,
    remote: !r.storage_path && !!r.remote_url,
    available: !!r.storage_path || !!r.remote_url,
  };
}

/** Tamanho legível: "512 B", "48 KB", "1,5 MB". Vazio quando o tamanho não é conhecido. */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
