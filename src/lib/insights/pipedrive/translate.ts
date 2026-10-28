/**
 * Tradução de um relatório do Insights do Pipedrive para o Oxyn. O formato é o mesmo; mudam as referências:
 * - campos personalizados (hash do Pipedrive) -> campo do Oxyn com o mesmo nome (personalizado ou nativo);
 * - opções (canal, resultado, etiqueta, etapa, funil, usuário, tipo) -> id do Oxyn pelo nome;
 * - a etiqueta da empresa sai (o escopo do relatório já é a empresa), inclusive "não é <outra empresa>";
 * - resultados de reunião do Pipedrive (Não compareceu, Remarcada) viram o "Resultado da reunião" do Oxyn;
 * - referência que não existe no Oxyn vira MISSING_ID (o filtro não traz nada, em vez de virar "todos").
 */
import { resolveField } from "../catalog";
import { definitionSchema, reportTypeInfo } from "../definition";
import type { Catalog, CatalogField, ChartType, DataType, InsightDefinition, InsightFilter, Operand } from "../types";

export const MISSING_ID = "00000000-0000-4000-8000-000000000000";

export type PdFilter = { filter: string; type?: string; operands?: { name: string; defaultValue: unknown }[]; period?: string | null };
export type PdReport = {
  id: string;
  name: string;
  data_type: string;
  report_type: string;
  chart_type: string;
  parameters: {
    group_by?: { filter: string; interval?: string | false | null } | null;
    measure_by?: string;
    measure_by_aggregation?: string | null;
    segment_by?: string | null;
    filter_by?: PdFilter[];
    stages?: (string | number)[];
    is_cumulative?: boolean;
    chart_size_amount?: number;
  };
  columns?: string[];
};

/** Metadados do Pipedrive (nomes de campos e de opções). */
export type PdMeta = {
  fieldName(entity: DataType, id: string): string | null;
  optionName(entity: DataType, id: string, value: string): string | null;
  userEmail(id: string): string | null;
  stage(id: string): { name: string; pipeline: string } | null;
  pipelineName(id: string): string | null;
};

/** O Oxyn da empresa de destino. */
export type Target = {
  catalog: Catalog;
  users: { id: string; email: string; name: string }[];
  /** nomes (normalizados) das etiquetas que são empresas do grupo */
  companyLabels: Set<string>;
  /** funil principal da empresa (usado quando o funil do Pipedrive é o de outra empresa) */
  mainPipelineId: string | null;
};

export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const PREFIXES = ["deal_id_", "lead_id_", "person_id_", "org_id_", "activity_id_"] as const;
const PD_TYPE_TO_CHANNEL: Record<string, string> = { call: "Telefone", ligacao: "Telefone", email: "E-mail", linkedin: "LinkedIn", whatsapp: "WhatsApp" };
const COMPANY_FIELD = "empresa proprietaria";
const MEETING_KEYS = new Set(["reuniao", "meeting", "reuniao_realizada"]);
/** Resultados do Pipedrive que no Oxyn são a situação da reunião (meeting_outcome). */
const MEETING_STATE: Record<string, string> = { "nao compareceu": "no_show", remarcada: "rescheduled", reagendada: "rescheduled", cancelada: "canceled" };
/** Resultados de tentativa do Pipedrive -> nome no Oxyn (o mesmo mapa da importação). */
const ATTEMPT: Record<string, string> = {
  conectado: "Conversa realizada",
  "deixou recado no correio de voz": "Sem resposta",
  concluido: "Conversa realizada",
  reagendado: "Respondeu, pediu retorno",
  cancelado: "Sem resposta",
  "resposta negativa": "Respondeu, sem interesse",
  "retorno futuro": "Respondeu, pediu retorno",
  "resposta positiva": "Conversa realizada",
  "contato invalido": "Número ou perfil inválido",
};

type Ctx = { pd: PdReport; meta: PdMeta; t: Target; dt: DataType; notes: string[] };

function splitPrefix(id: string): { prefix: string; rest: string } {
  const p = PREFIXES.find((x) => id.startsWith(x));
  return p ? { prefix: p, rest: id.slice(p.length) } : { prefix: "", rest: id };
}

/** Entidade do campo ligado (pelo prefixo) ou a própria. */
function entityOf(c: Ctx, prefix: string): DataType | null {
  if (!prefix) return c.dt;
  return c.t.catalog.links[c.dt]?.[prefix] ?? null;
}

/** Id do campo no Oxyn: nativo com o mesmo id, ou o campo da entidade com o mesmo nome do personalizado do Pipedrive. */
function mapFieldId(c: Ctx, pdId: string): { id: string; field: CatalogField } | null {
  const own = resolveField(c.t.catalog, c.dt, pdId, c.pd.report_type);
  if (own && !/^[0-9a-f]{40}$/.test(splitPrefix(pdId).rest)) return { id: pdId, field: own.field };
  const { prefix, rest } = splitPrefix(pdId);
  const ent = entityOf(c, prefix);
  if (!ent) return null;
  const name = c.meta.fieldName(c.dt, pdId) ?? c.meta.fieldName(ent, rest);
  if (!name) return null;
  const f = (c.t.catalog.fields[ent] ?? []).find((x) => norm(x.name) === norm(name) && !x.rts);
  if (!f) return null;
  const id = prefix + f.id;
  const r = resolveField(c.t.catalog, c.dt, id, c.pd.report_type);
  return r ? { id, field: r.field } : null;
}

const byName = (list: { id: string; label: string }[] | undefined, name: string | null) =>
  name ? (list ?? []).find((o) => norm(o.label) === norm(name))?.id ?? null : null;

type Mapped = { values: string[]; drop?: boolean; meeting?: string[] };

/** Valores de um filtro no Oxyn, pela fonte das opções do campo de destino. */
function mapValues(c: Ctx, pdId: string, field: CatalogField, raw: string[]): Mapped {
  const { prefix, rest } = splitPrefix(pdId);
  const ent = entityOf(c, prefix) ?? c.dt;
  const opts = c.t.catalog.options;
  const name = (v: string) => c.meta.optionName(c.dt, pdId, v) ?? c.meta.optionName(ent, rest, v);
  const src = field.opts;
  // "Empresa Proprietária" faz o papel da etiqueta da empresa: sai (o escopo já é a empresa)
  if (norm(field.name) === COMPANY_FIELD) {
    const kept = raw.filter((v) => !c.t.companyLabels.has(norm(name(v) ?? v)));
    if (kept.length === 0) return { values: [], drop: true };
    raw = kept;
  }
  if (Array.isArray(src)) {
    // lista fixa (status, booleanos) ou personalizado de opção: o Pipedrive guarda o id da opção
    const keys = new Set(src.map(([k]) => k));
    return { values: raw.map((v) => (keys.has(v) ? v : (src.find(([, l]) => norm(l) === norm(name(v) ?? ""))?.[0] ?? MISSING_ID))) };
  }
  switch (src) {
    case "users":
      return {
        values: raw.map((v) => {
          const email = c.meta.userEmail(v);
          return c.t.users.find((u) => email && u.email.toLowerCase() === email.toLowerCase())?.id ?? byName(c.t.users.map((u) => ({ id: u.id, label: u.name })), name(v)) ?? MISSING_ID;
        }),
      };
    case "labels": {
      const kept = raw.filter((v) => !c.t.companyLabels.has(norm(name(v) ?? "")));
      if (kept.length === 0) return { values: [], drop: true };
      return { values: kept.map((v) => byName(opts.labels, name(v)) ?? MISSING_ID) };
    }
    case "channels":
      return { values: raw.map((v) => byName(opts.channels, name(v)) ?? MISSING_ID) };
    case "lost_reasons":
      return { values: raw.map((v) => byName(opts.lost_reasons, name(v)) ?? MISSING_ID) };
    case "disq_reasons":
      return { values: raw.map((v) => byName(opts.disq_reasons, name(v)) ?? MISSING_ID) };
    case "pipelines":
      return { values: raw.map((v) => mapPipeline(c, v) ?? MISSING_ID) };
    case "stages":
      return { values: raw.map((v) => mapStage(c, v) ?? MISSING_ID) };
    case "kinds":
      return {
        values: raw.map((v) => {
          const key = norm(String(v));
          if (MEETING_KEYS.has(key)) return (opts.kinds ?? []).find((k) => norm(k.label) === "reuniao")?.id ?? MISSING_ID;
          return byName(opts.kinds, PD_TYPE_TO_CHANNEL[key] ?? name(v)) ?? MISSING_ID;
        }),
      };
    case "outcomes": {
      const values: string[] = [];
      const meeting: string[] = [];
      for (const v of raw) {
        const n = norm(name(v) ?? "");
        const state = MEETING_STATE[n];
        // "Não compareceu"/"Cancelado" existem como tentativa e como reunião; as de reunião vêm depois no Pipedrive
        if (state && (n === "remarcada" || Number(v) >= 89)) meeting.push(state);
        else values.push(byName(opts.outcomes, ATTEMPT[n] ?? name(v)) ?? MISSING_ID);
      }
      return { values, meeting };
    }
    default:
      c.notes.push(`valor de ${field.name} sem tradução (${src})`);
      return { values: raw.map(() => MISSING_ID) };
  }
}

function mapPipeline(c: Ctx, pdPipeline: string): string | null {
  const name = c.meta.pipelineName(pdPipeline);
  const own = byName(c.t.catalog.options.pipelines, name);
  if (own) return own;
  // funil com nome de empresa do grupo: é o funil da empresa do modelo; usa o principal da empresa de destino
  return name && c.t.companyLabels.has(norm(name)) ? c.t.mainPipelineId : null;
}

function mapStage(c: Ctx, pdStage: string): string | null {
  const s = c.meta.stage(pdStage);
  if (!s) return null;
  const pipe = byName(c.t.catalog.options.pipelines, s.pipeline) ?? (c.t.companyLabels.has(norm(s.pipeline)) ? c.t.mainPipelineId : null);
  return (c.t.catalog.options.stages ?? []).find((x) => x.pipeline_id === pipe && norm(x.label) === norm(s.name))?.id ?? null;
}

/** Campo sempre preenchido de cada entidade: "tem <entidade> ligada" quando a etiqueta da empresa sai do filtro ligado. */
const ANCHOR: Record<DataType, string> = { leads: "title", deals: "title", people: "name", organizations: "name", activities: "subject" };

const MULTI = new Set(["isAnyOf", "isNotAnyOf", "isExcluding"]);
const NEGATIVE = new Set(["isNot", "isNotAnyOf", "isExcluding"]);
const NO_VALUE = new Set(["isEmpty", "isNotEmpty"]);

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (v === null || v === undefined || v === "") return [];
  return [String(v)];
}

function translateFilter(c: Ctx, f: PdFilter): InsightFilter[] {
  const m = mapFieldId(c, f.filter);
  if (!m) {
    c.notes.push(`filtro sem campo no Oxyn: ${f.filter}`);
    return [];
  }
  const isDate = m.field.type === "DATE" || m.field.type === "DATE_TIME";
  const period = (f.period ?? null) as InsightFilter["period"];
  if (isDate) {
    const operands = (f.operands ?? []).filter((o) => o.name !== "format") as Operand[];
    return [{ filter: m.id, type: m.field.type, period, operands: period && period !== "custom" ? [] : operands }];
  }
  const out: InsightFilter[] = [];
  const operands: Operand[] = [];
  let meetingFilter: InsightFilter | null = null;
  for (const o of f.operands ?? []) {
    if (o.name === "format") continue;
    if (NO_VALUE.has(o.name) || m.field.type === "BOOLEAN" || m.field.type === "NUMERICAL" || m.field.type === "MONETARY" || m.field.type === "TEXT") {
      operands.push({ name: o.name as Operand["name"], defaultValue: o.defaultValue });
      continue;
    }
    const mapped = mapValues(c, f.filter, m.field, asList(o.defaultValue));
    if (mapped.drop) {
      c.notes.push(`etiqueta da empresa removida (${f.filter})`);
      // "o lead da atividade tem a etiqueta da empresa" também exige que haja um lead ligado
      const { prefix } = splitPrefix(m.id);
      const ent = entityOf(c, prefix);
      if (prefix && ent && !NEGATIVE.has(o.name)) out.push({ filter: prefix + ANCHOR[ent], type: "TEXT", period: null, operands: [{ name: "isNotEmpty", defaultValue: true }] });
      continue;
    }
    if (mapped.meeting?.length) {
      const prefix = splitPrefix(m.id).prefix;
      meetingFilter = {
        filter: `${prefix}meetingOutcome`,
        type: "SINGLE_OPTION",
        period: null,
        operands: [{ name: (MULTI.has(o.name) ? o.name : o.name === "isNot" ? "isNotAnyOf" : "isAnyOf") as Operand["name"], defaultValue: mapped.meeting }],
      };
    }
    let values = mapped.values;
    if (NEGATIVE.has(o.name)) values = values.filter((v) => v !== MISSING_ID);
    if (values.length === 0) continue;
    if (values.includes(MISSING_ID)) c.notes.push(`referência inexistente no Oxyn em ${m.field.name}`);
    operands.push({ name: o.name as Operand["name"], defaultValue: MULTI.has(o.name) ? values : values.length > 1 ? values : values[0]! });
  }
  if (operands.length) out.push({ filter: m.id, type: m.field.type, period: null, operands });
  if (meetingFilter && resolveField(c.t.catalog, c.dt, meetingFilter.filter, c.pd.report_type)) out.push(meetingFilter);
  return out;
}

export type Translated = { def: InsightDefinition | null; notes: string[] };

export function translateReport(pd: PdReport, meta: PdMeta, t: Target): Translated {
  const notes: string[] = [];
  const dt = pd.data_type as DataType;
  if (!reportTypeInfo(dt, pd.report_type)) return { def: null, notes: [`tipo de relatório não suportado: ${pd.data_type}/${pd.report_type}`] };
  const c: Ctx = { pd, meta, t, dt, notes };
  const P = pd.parameters ?? {};

  const filter_by = (P.filter_by ?? []).flatMap((f) => translateFilter(c, f));
  const field = (id: string | null | undefined) => (id ? mapFieldId(c, id) : null);
  let group_by: InsightDefinition["parameters"]["group_by"];
  if (P.group_by?.filter && P.group_by.filter !== "funnelStage") {
    const g = field(P.group_by.filter);
    if (g && (g.field.roles.includes("g") || g.field.roles.includes("s"))) {
      const isDate = g.field.type === "DATE" || g.field.type === "DATE_TIME";
      group_by = { filter: g.id, interval: isDate ? ((P.group_by.interval || "month") as "month") : false };
    } else notes.push(`ver por sem campo no Oxyn: ${P.group_by.filter}`);
  }
  let segment_by: string | null = null;
  if (P.segment_by && P.segment_by !== "none") {
    const s = field(P.segment_by);
    if (s && s.field.roles.includes("s")) segment_by = s.id;
    else notes.push(`segmentar por sem campo no Oxyn: ${P.segment_by}`);
  }
  let measure_by = P.measure_by ?? "count";
  if (measure_by !== "count") {
    const m = field(measure_by);
    if (m && m.field.roles.includes("m")) measure_by = m.id;
    else {
      notes.push(`medida sem campo no Oxyn: ${measure_by}`);
      measure_by = "count";
    }
  }
  const stages =
    pd.report_type === "funnel_conversion"
      ? (P.stages ?? []).map((s) => mapStage(c, String(s))).filter((s): s is string => !!s)
      : undefined;
  const columns = (pd.columns ?? [])
    .map((col) => field(col))
    .filter((x): x is { id: string; field: CatalogField } => !!x && x.field.roles.includes("c"))
    .map((x) => x.id);

  const def = {
    data_type: dt,
    report_type: pd.report_type,
    chart_type: pd.chart_type as ChartType,
    parameters: {
      ...(group_by ? { group_by } : {}),
      measure_by,
      measure_by_aggregation: (P.measure_by_aggregation as InsightDefinition["parameters"]["measure_by_aggregation"]) ?? null,
      segment_by,
      filter_by,
      ...(stages ? { stages } : {}),
      is_cumulative: !!P.is_cumulative,
      ...(P.chart_size_amount ? { chart_size_amount: P.chart_size_amount } : {}),
    },
    columns: [...new Set(columns)],
    colors: {},
  };
  const parsed = definitionSchema.safeParse(def);
  if (!parsed.success) return { def: null, notes: [...notes, `definição inválida: ${parsed.error.issues[0]?.message}`] };
  return { def: parsed.data as InsightDefinition, notes };
}

/**
 * Empresas (nomes normalizados) a que um relatório do Pipedrive se refere: etiqueta da empresa, "Empresa
 * Proprietária", funil com nome de empresa e o nome do relatório ("Naia LEADS - ...", "PIPELINE GERAL - OMNI11").
 */
export function pdCompanies(pd: PdReport, meta: PdMeta, companies: Set<string>): string[] {
  const found = new Set<string>();
  const dt = pd.data_type as DataType;
  for (const f of pd.parameters?.filter_by ?? []) {
    const { prefix, rest } = splitPrefix(f.filter);
    const fieldName = norm(meta.fieldName(dt, f.filter) ?? "");
    const isLabel = rest === "label" || fieldName === COMPANY_FIELD;
    for (const o of f.operands ?? []) {
      if (NEGATIVE.has(o.name)) continue;
      for (const v of asList(o.defaultValue)) {
        if (isLabel) {
          const n = norm(meta.optionName(dt, f.filter, v) ?? "");
          if (companies.has(n)) found.add(n);
        } else if (rest === "pipelineId" && !prefix) {
          const n = norm(meta.pipelineName(v) ?? "");
          if (companies.has(n)) found.add(n);
        }
      }
    }
  }
  if (found.size === 0) {
    const n = norm(pd.name);
    for (const company of companies) if (new RegExp(`(^|[^a-z0-9])${company.replace(/ /g, " ")}($|[^a-z0-9])`).test(n)) found.add(company);
  }
  return [...found];
}
