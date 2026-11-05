import { formatDateTime } from "@/lib/activities/time";
import { decodeSnippet } from "@/lib/gmail/thread-view";

export const STATUS_LABELS: Record<string, string> = {
  open: "Aberto",
  converted: "Convertido",
  disqualified: "Desqualificado",
  archived: "Arquivado",
};

const FIELD_LABELS: Record<string, Record<string, string>> = {
  organizations: {
    name: "nome",
    legal_name: "razão social",
    cnpj: "CNPJ",
    domain: "domínio",
    segment: "segmento",
    address: "endereço",
    custom_fields: "campos personalizados",
  },
  persons: {
    full_name: "nome",
    job_title: "cargo",
    organization_id: "organização",
    emails: "e-mails",
    phones: "telefones",
    linkedin_url: "LinkedIn",
    custom_fields: "campos personalizados",
  },
  leads: {
    title: "título",
    source_id: "origem",
    person_id: "pessoa",
    organization_id: "organização",
    estimated_value: "valor estimado",
    custom_fields: "campos personalizados",
  },
  deals: {
    title: "título",
    pipeline_id: "funil",
    stage_id: "etapa",
    person_id: "pessoa",
    organization_id: "organização",
    estimated_value: "valor estimado",
    expected_close_date: "data de fechamento",
    setup_total: "setup",
    setup_installments: "parcelas do setup",
    setup_first_due: "primeira parcela",
    mrr: "MRR",
    mrr_start: "início do MRR",
    contract_months: "duração do contrato",
    lost_note: "nota de perda",
    custom_fields: "campos personalizados",
  },
};

const MEETING_OUTCOME_TEXT: Record<string, string> = {
  held: "Realizada",
  no_show: "No-show",
  rescheduled: "Remarcada",
  canceled: "Cancelada",
};

export type EventLike = { kind: string; entity: string; data: Record<string, unknown> | null };

/** "a", "a e b", "a, b e c". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Texto do evento; `names` mapeia ids (usuários, motivos) para nomes. Vazio = sem texto próprio. */
export function describeEvent(event: EventLike, names: Record<string, string>): string {
  const d = event.data ?? {};
  switch (event.kind) {
    case "created":
      return "Criou o registro";
    case "trashed":
      return "Moveu para a lixeira";
    case "restored":
      return "Restaurou da lixeira";
    case "owner_changed":
      return `Trocou o responsável de ${names[str(d.from)] ?? "alguém"} para ${names[str(d.to)] ?? "alguém"}`;
    case "stage_changed":
      return `Moveu de ${names[str(d.from)] ?? "outra etapa"} para ${names[str(d.to)] ?? "outra etapa"}`;
    case "converted":
      return "Converteu em negócio";
    case "status_changed": {
      const to = str(d.to);
      const reason = names[str(d.reason_id)];
      if (event.entity === "deals") {
        if (to === "won") return "Marcou como ganho";
        if (to === "lost") return `Marcou como perdido${reason ? ` (${reason})` : ""}`;
        return "Reabriu o negócio";
      }
      return `Mudou o status para ${STATUS_LABELS[to] ?? to}${reason ? ` (${reason})` : ""}`;
    }
    case "label_added":
      return `Adicionou a etiqueta ${str(d.name)}`;
    case "label_removed":
      return `Removeu a etiqueta ${str(d.name)}`;
    case "updated": {
      const map = FIELD_LABELS[event.entity] ?? {};
      const fields = Array.isArray(d.fields) ? d.fields.map(String) : [];
      const labels = fields.map((f) => map[f]).filter((l): l is string => Boolean(l));
      return labels.length > 0 ? `Editou ${joinList(labels)}` : "Editou o registro";
    }
    case "activity_scheduled": {
      const subject = names[str(d.activity_id)] ?? "atividade";
      const type = str(d.type) || "atividade";
      const due = str(d.due_at);
      return `Agendou ${type}: ${subject}${due ? ` para ${formatDateTime(due)}` : ""}`;
    }
    case "activity_completed": {
      const id = str(d.activity_id);
      const subject = names[id] ?? "atividade";
      const type = str(d.type) || names[`type:${id}`] || "atividade";
      const result = MEETING_OUTCOME_TEXT[str(d.meeting_outcome)] ?? str(d.outcome);
      return `Concluiu ${type}: ${subject}${result ? ` (${result})` : ""}`;
    }
    default:
      return "";
  }
}

export type CompletedActivityRow = {
  id: string;
  subject: string;
  typeName: string | null;
  ownerName: string | null;
  completed_at: string | null;
  due_at: string | null;
  created_at: string;
  meeting_outcome: string | null;
  completion_note: string | null;
};

/** Atividade concluída lida da tabela (inclui as importadas do Pipedrive, que não têm evento). */
export function activityTimelineItem(a: CompletedActivityRow): {
  kind: "activity_completed";
  at: string;
  actorName: string;
  text: string;
  detail: string | null;
} {
  const result = a.meeting_outcome ? MEETING_OUTCOME_TEXT[a.meeting_outcome] : undefined;
  return {
    kind: "activity_completed",
    at: a.completed_at ?? a.due_at ?? a.created_at,
    actorName: a.ownerName?.trim() || "Alguém",
    text: `${a.typeName?.trim() || "Atividade"}: ${a.subject}${result ? ` (${result})` : ""}`,
    detail: a.completion_note?.trim() || null,
  };
}

export type TimelineCategory = "note" | "activity" | "change";

/** Grupo do filtro do histórico: anotações, atividades e, no resto, alterações do registro. */
export function timelineCategory(kind: string): TimelineCategory {
  if (kind === "note") return "note";
  if (kind === "activity_scheduled" || kind === "activity_completed") return "activity";
  return "change";
}

/** Une listas já ordenadas ou não e devolve da mais recente para a mais antiga (empate mantém a ordem). */
export function sortByAtDesc<T extends { at: string }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i, t: Date.parse(item.at) || 0 }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.item);
}

export type NoteChunk = { type: "text" | "link"; value: string };

const HTML_TAG = /<\/?[a-z][^>]*>/i;

/**
 * Anotações importadas do Pipedrive vêm em HTML. Vira texto: quebras de linha, itens com "•", links com a URL
 * visível (para o `linkify`) e entidades decodificadas. Texto simples (anotações do CRM) fica como está.
 */
export function noteText(body: string): string {
  if (!HTML_TAG.test(body)) return body;
  const text = body
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const url = decodeSnippet(href);
      const label = decodeSnippet(inner.replace(/<[^>]+>/g, "")).trim();
      if (!/^https?:/i.test(url) || !label || label === url) return label || url;
      return `${label} (${url})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    .replace(/<\/(div|p|ul|ol|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeSnippet(text)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\n(?=• )/g, "\n")
    .trim();
}

/** Separa URLs http(s) do resto; o restante fica como texto puro (React escapa). */
export function linkify(body: string): NoteChunk[] {
  const out: NoteChunk[] = [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const m of body.matchAll(re)) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", value: body.slice(last, start) });
    out.push({ type: "link", value: url });
    last = start + url.length;
  }
  if (last < body.length) out.push({ type: "text", value: body.slice(last) });
  return out.length > 0 ? out : [{ type: "text", value: body }];
}
