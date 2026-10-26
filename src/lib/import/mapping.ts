import type { ImportMappings, PdItem } from "./pipedrive/types";

export type MapError = { error: string };
export type Row = Record<string, unknown>;
export type MapResult = Row | MapError;

/** Contato (pessoa ou organização) visto pelos negócios e leads ligados a ele. */
export type ContactLink =
  | { type: "deal"; pipelineId: string | number }
  | { type: "lead"; labelIds: (string | number)[] };

export type MapCtx = {
  mappings: ImportMappings;
  /** Empresa de destino para contatos, atividades, anotações e produtos. */
  companyId?: string;
  /** Destinos já criados na importação para funis/etapas mapeados como null. */
  resolvedPipelines?: Record<string, { pipelineId: string; stages: Record<string, string> }>;
  /** campo (key) -> id da opção -> rótulo (de dealFields/personFields/organizationFields) */
  fieldOptions?: Record<string, Record<string, string>>;
  /** key_string do tipo de atividade -> nome (para task "Whatsapp") */
  activityTypeNames?: Record<string, string>;
  /** id da etiqueta de lead -> nome */
  leadLabelNames?: Record<string, string>;
  /** chave do contato (ex.: "person:12") -> vínculos */
  contactLinks?: Record<string, ContactLink[]>;
};

export function isError(r: MapResult): r is MapError {
  return typeof (r as MapError).error === "string";
}

// ---- leitura defensiva ---------------------------------------------------------------------------------------

/** Pipedrive devolve ids como número, string ou objeto {value|id, name}. */
export function refId(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return refId(o.value ?? o.id);
  }
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return typeof v === "number" ? String(v) : null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object") return num((v as Record<string, unknown>).value ?? (v as Record<string, unknown>).amount);
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "2024-03-10 14:00:00" (UTC) -> "2024-03-10T14:00:00Z" */
export function toIso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3] ?? "00"}Z`;
}

function dateOnly(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** due_date + due_time (UTC). Sem hora: 12:00 de São Paulo = 15:00Z. */
export function dueAt(date: unknown, time: unknown): string | null {
  const d = dateOnly(date);
  if (!d) return null;
  const t = str(time);
  const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
  const hhmm = m ? `${m[1].padStart(2, "0")}:${m[2]}` : "15:00";
  return `${d}T${hhmm}:00Z`;
}

export function clampMonths(v: unknown): number | null {
  const n = num(v);
  if (n === null) return null;
  return Math.min(120, Math.max(1, Math.round(n)));
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function ownerOf(v: unknown, m: ImportMappings): string {
  const id = refId(v);
  return (id && m.users[id]) || m.fallbackOwnerId;
}

function contacts(v: unknown): Row[] {
  if (!Array.isArray(v)) return [];
  const out: Row[] = [];
  for (const e of v) {
    if (typeof e === "string") {
      if (e.trim()) out.push({ value: e.trim() });
    } else if (e && typeof e === "object") {
      const o = e as Record<string, unknown>;
      const value = str(o.value);
      if (value) out.push(str(o.label) ? { value, label: str(o.label) } : { value });
    }
  }
  return out;
}

// ---- tipos e canais de atividade -----------------------------------------------------------------------------

export function channelFor(typeKey: string, typeName?: string | null): string | null {
  switch (typeKey) {
    case "call":
      return "Ligação";
    case "email":
      return "E-mail";
    case "linkedin":
      return "LinkedIn";
    case "whatsapp":
      return "WhatsApp";
    case "task":
      return norm(typeName ?? "") === "whatsapp" ? "WhatsApp" : null;
    default:
      return null;
  }
}

const MEETING_KEYS = new Set(["meeting", "reuniao", "reuniao_realizada", "lunch"]);

export function activityKind(typeKey: string): "meeting" | "task" {
  return MEETING_KEYS.has(typeKey) ? "meeting" : "task";
}

// ---- campos personalizados -----------------------------------------------------------------------------------

function customValue(raw: unknown, options: Record<string, string> | undefined): unknown {
  const label = (id: string) => options?.[id] ?? id;
  if (Array.isArray(raw)) {
    return raw.map((e) => (typeof e === "object" && e ? str((e as Row).label ?? (e as Row).name) ?? label(refId(e) ?? "") : label(String(e))));
  }
  if (raw && typeof raw === "object") {
    const o = raw as Row;
    return str(o.name) ?? str(o.label) ?? label(refId(o) ?? "");
  }
  if (typeof raw === "number") return options ? label(String(raw)) : raw;
  if (typeof raw === "string") {
    if (options && /^\d+(,\d+)*$/.test(raw)) {
      const parts = raw.split(",").map(label);
      return parts.length === 1 ? parts[0] : parts;
    }
    return raw;
  }
  return raw;
}

type Natives = { setup_total?: number; mrr?: number; contract_months?: number };

function applyCustom(item: PdItem, ctx: MapCtx): { custom: Row; natives: Natives } {
  const custom: Row = {};
  const natives: Natives = {};
  for (const [key, target] of Object.entries(ctx.mappings.customFields)) {
    const raw = item[key];
    if (raw === null || raw === undefined || raw === "") continue;
    if (target.target === "native:setup_total") {
      const n = num(raw);
      if (n !== null) natives.setup_total = n;
    } else if (target.target === "native:mrr") {
      const n = num(raw);
      if (n !== null) natives.mrr = n;
    } else if (target.target === "native:contract_months") {
      const n = clampMonths(raw);
      if (n !== null) natives.contract_months = n;
    } else if (target.customFieldKey) {
      const v = customValue(raw, ctx.fieldOptions?.[key]);
      if (v !== "" && !(Array.isArray(v) && v.length === 0)) custom[target.customFieldKey] = v;
    }
  }
  return { custom, natives };
}

// ---- empresas ------------------------------------------------------------------------------------------------

export function leadCompany(lead: PdItem, m: ImportMappings): string {
  const ids = Array.isArray(lead.label_ids) ? lead.label_ids : [];
  for (const id of ids) {
    const c = m.leadLabelCompany[String(id)];
    if (c) return c;
  }
  return m.defaultCompanyId;
}

export function companiesForContact(contactId: string, ctx: MapCtx): string[] {
  const set = new Set<string>();
  for (const l of ctx.contactLinks?.[contactId] ?? []) {
    if (l.type === "deal") {
      const p = ctx.mappings.pipelines[String(l.pipelineId)];
      if (p && !ctx.mappings.ignorePipelines.includes(String(l.pipelineId))) set.add(p.companyId);
    } else {
      set.add(leadCompany({ label_ids: l.labelIds }, ctx.mappings));
    }
  }
  return set.size ? [...set] : [ctx.mappings.defaultCompanyId];
}

// ---- mapeadores ----------------------------------------------------------------------------------------------

function needCompany(ctx: MapCtx): string | MapError {
  return ctx.companyId ?? { error: "empresa de destino não definida" };
}

function extId(item: PdItem): string | MapError {
  return refId(item.id) ?? { error: "item sem id" };
}

export function mapOrganization(item: PdItem, ctx: MapCtx): MapResult {
  const external_id = extId(item);
  const company_id = needCompany(ctx);
  if (typeof external_id !== "string") return external_id;
  if (typeof company_id !== "string") return company_id;
  const name = str(item.name);
  if (!name) return { error: "organização sem nome" };
  const { custom } = applyCustom(item, ctx);
  return {
    external_id,
    company_id,
    owner_id: ownerOf(item.owner_id, ctx.mappings),
    name,
    address: str(item.address) ?? {},
    custom_fields: custom,
    created_at: toIso(item.add_time),
  };
}

export function mapPerson(item: PdItem, ctx: MapCtx): MapResult {
  const external_id = extId(item);
  const company_id = needCompany(ctx);
  if (typeof external_id !== "string") return external_id;
  if (typeof company_id !== "string") return company_id;
  const name = str(item.name);
  if (!name) return { error: "pessoa sem nome" };
  const { custom } = applyCustom(item, ctx);
  return {
    external_id,
    company_id,
    owner_id: ownerOf(item.owner_id, ctx.mappings),
    name,
    emails: contacts(item.email),
    phones: contacts(item.phone),
    organization_external_id: refId(item.org_id),
    custom_fields: custom,
    created_at: toIso(item.add_time),
  };
}

export function mapLead(item: PdItem, ctx: MapCtx): MapResult {
  const external_id = extId(item);
  if (typeof external_id !== "string") return external_id;
  const title = str(item.title);
  if (!title) return { error: "lead sem título" };
  const m = ctx.mappings;
  const labelIds = Array.isArray(item.label_ids) ? item.label_ids.map(String) : [];
  const labels = labelIds
    .filter((id) => !m.leadLabelCompany[id])
    .map((id) => ctx.leadLabelNames?.[id])
    .filter((n): n is string => !!n);
  const { custom } = applyCustom(item, ctx);
  return {
    external_id,
    company_id: leadCompany(item, m),
    owner_id: ownerOf(item.owner_id, m),
    title,
    value: num(item.value),
    person_external_id: refId(item.person_id),
    organization_external_id: refId(item.organization_id ?? item.org_id),
    source_name: str(item.source_name),
    labels,
    status: item.is_archived === true ? "archived" : "open",
    custom_fields: custom,
    created_at: toIso(item.add_time),
  };
}

export function mapDeal(item: PdItem, ctx: MapCtx): MapResult {
  const external_id = extId(item);
  if (typeof external_id !== "string") return external_id;
  const m = ctx.mappings;
  const pdPipeline = refId(item.pipeline_id);
  if (!pdPipeline) return { error: "negócio sem funil" };
  if (m.ignorePipelines.includes(pdPipeline)) return { error: `funil ${pdPipeline} ignorado` };
  const pm = m.pipelines[pdPipeline];
  if (!pm) return { error: `funil ${pdPipeline} sem mapeamento` };
  const resolved = ctx.resolvedPipelines?.[pdPipeline];
  const pipeline_id = pm.pipelineId ?? resolved?.pipelineId ?? null;
  if (!pipeline_id) return { error: `funil ${pdPipeline} sem destino` };
  const pdStage = refId(item.stage_id);
  const stage_id = pdStage ? (pm.stages[pdStage] ?? resolved?.stages[pdStage] ?? null) : null;
  if (!stage_id) return { error: `etapa ${pdStage ?? "?"} sem mapeamento` };
  const title = str(item.title);
  if (!title) return { error: "negócio sem título" };
  const status = str(item.status);
  if (status !== "open" && status !== "won" && status !== "lost") return { error: `status inválido: ${status ?? "vazio"}` };

  const { custom, natives } = applyCustom(item, ctx);
  const lead = str(item.lead_id) ?? (str(item.origin) === "Leads" ? str(item.origin_id) : null);
  return {
    external_id,
    company_id: pm.companyId,
    owner_id: ownerOf(item.owner_id ?? item.user_id, m),
    pipeline_id,
    stage_id,
    title,
    status,
    value: num(item.value),
    setup_total: natives.setup_total ?? 0,
    mrr: natives.mrr ?? 0,
    contract_months: natives.contract_months ?? null,
    expected_close_date: dateOnly(item.expected_close_date),
    won_at: status === "won" ? toIso(item.won_time) : null,
    lost_at: status === "lost" ? toIso(item.lost_time) : null,
    lost_reason: status === "lost" ? str(item.lost_reason) : null,
    stage_entered_at: toIso(item.stage_change_time),
    person_external_id: refId(item.person_id),
    organization_external_id: refId(item.org_id),
    lead_external_id: lead,
    custom_fields: custom,
    created_at: toIso(item.add_time),
  };
}

export function mapActivity(item: PdItem, ctx: MapCtx): MapResult {
  const external_id = extId(item);
  const company_id = needCompany(ctx);
  if (typeof external_id !== "string") return external_id;
  if (typeof company_id !== "string") return company_id;
  const deal = refId(item.deal_id);
  const lead = str(item.lead_id);
  const person = refId(item.person_id);
  const org = refId(item.org_id);
  if (!deal && !lead && !person && !org) return { error: "atividade sem negócio, lead, pessoa ou organização" };
  const typeKey = str(item.type) ?? "task";
  const kind = activityKind(typeKey);
  const done = item.done === true || item.done === 1 || item.done === "1";
  const due = dueAt(item.due_date, item.due_time);
  return {
    external_id,
    company_id,
    owner_id: ownerOf(item.user_id ?? item.owner_id ?? item.assigned_to_user_id, ctx.mappings),
    type: kind,
    channel_name: channelFor(typeKey, ctx.activityTypeNames?.[typeKey]),
    subject: str(item.subject),
    due_at: due,
    done,
    completed_at: done ? (toIso(item.marked_as_done_time) ?? due) : null,
    meeting_outcome: done && typeKey === "reuniao_realizada" ? "held" : null,
    note: str(item.note) ?? str(item.public_description),
    deal_external_id: deal,
    lead_external_id: lead,
    person_external_id: person,
    organization_external_id: org,
    created_at: toIso(item.add_time),
  };
}

export function mapNote(item: PdItem, ctx: MapCtx): MapResult {
  const external_id = extId(item);
  const company_id = needCompany(ctx);
  if (typeof external_id !== "string") return external_id;
  if (typeof company_id !== "string") return company_id;
  const content = str(item.content);
  if (!content) return { error: "anotação vazia" };
  const targets: [string, string | null][] = [
    ["deals", refId(item.deal_id)],
    ["leads", str(item.lead_id)],
    ["persons", refId(item.person_id)],
    ["organizations", refId(item.org_id)],
  ];
  const hit = targets.find(([, id]) => id);
  if (!hit) return { error: "anotação sem negócio, lead, pessoa ou organização" };
  const user = refId(item.user_id);
  return {
    external_id,
    company_id,
    entity: hit[0],
    record_external_id: hit[1],
    content,
    author_id: (user && ctx.mappings.users[user]) || null,
    created_at: toIso(item.add_time),
  };
}

export function mapProduct(item: PdItem, ctx: MapCtx): MapResult {
  const external_id = extId(item);
  const company_id = needCompany(ctx);
  if (typeof external_id !== "string") return external_id;
  if (typeof company_id !== "string") return company_id;
  const name = str(item.name);
  if (!name) return { error: "produto sem nome" };
  const prices = Array.isArray(item.prices) ? (item.prices as Row[]) : [];
  return { external_id, company_id, name, kind: "setup", price: num(prices[0]?.price) ?? 0 };
}
