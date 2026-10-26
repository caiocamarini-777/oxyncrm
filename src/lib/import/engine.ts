import "server-only";
import { PipedriveAuthError } from "./pipedrive/client";
import { ImportMappings, type PdFieldDef, type PdItem, type PdPage, type PdPageEntity } from "./pipedrive/types";
import {
  leadCompany,
  mapActivity,
  mapDeal,
  mapLead,
  mapNote,
  mapOrganization,
  mapPerson,
  mapProduct,
  refId,
  type MapCtx,
  type MapResult,
  type OxynFieldType,
  type Row,
} from "./mapping";

// ---- contratos ---------------------------------------------------------------------------------------------------

export const STEPS = [
  "index",
  "users_check",
  "custom_fields",
  "products",
  "organizations",
  "persons",
  "leads",
  "archived_leads",
  "deals",
  "derivatives",
  "activities",
  "notes",
  "done",
] as const;
export type Step = (typeof STEPS)[number];

/** Entidades aceitas por import_upsert (também são as chaves de counters). */
export type DbEntity = "organizations" | "persons" | "leads" | "deals" | "activities" | "notes" | "products";

/**
 * Índices compactos (só ids) guardados em import_jobs.cursor.cache.
 * Empresas são referenciadas pela posição em `companies` para manter o JSON pequeno.
 */
export type ImportCache = {
  companies: string[];
  /** id do negócio no Pipedrive -> empresa (só negócios de funis mapeados e não ignorados) */
  deals: Record<string, number>;
  /** negócios de funis ignorados ou sem mapeamento: atividades e anotações deles são puladas */
  ignoredDeals: Record<string, 1>;
  /** id do lead -> empresa */
  leads: Record<string, number>;
  /** "person:12" / "org:5" -> empresas vistas pelos negócios e leads do contato (a primeira é a principal) */
  contacts: Record<string, number[]>;
  /** id do usuário do Pipedrive dono de negócios -> empresas desses negócios */
  dealOwners: Record<string, number[]>;
  /** funis mapeados como null, criados na etapa custom_fields */
  pipelines?: Record<string, { pipelineId: string; stages: Record<string, string> }>;
  /** "<empresa>:<entidade>:<customFieldKey>" -> tipo do campo no Oxyn */
  fieldTypes?: Record<string, OxynFieldType>;
  /** "<perfil>:<empresa>" -> contatos copiados para empresa secundária com o dono padrão (avisos da etapa) */
  ownerSwaps?: Record<string, number>;
};

export type ImportCursor = { step?: Step; start?: number; sub?: number; cache?: ImportCache };

export type JobStatus = "draft" | "running" | "paused" | "done" | "failed";

export type JobRecord = {
  id: string;
  status: JobStatus;
  mappings: unknown;
  cursor: ImportCursor;
  counters: Record<string, Record<string, number>>;
};

export type UpsertCounts = { created: number; updated: number; skipped: number; unchanged: number; errors: number };
export type LogItem = { entity: string; external_id: string | null; reason: string };
export type CustomFieldDef = { id: string; company_id: string; entity: string; key: string; type: string; options: string[] };
export type NewCustomFieldDef = Omit<CustomFieldDef, "id"> & { label: string };
export type MembersInfo = {
  /** empresa -> perfis ativos com acesso (membros ou admin geral) */
  active: Record<string, string[]>;
  userNames: Record<string, string>;
  companyNames: Record<string, string>;
};
export type ExistingPipeline = {
  id: string;
  archived: boolean;
  stages: { id: string; name: string; position: number; archived: boolean }[];
};

/** Leitura do Pipedrive usada pelo motor (o cliente real satisfaz este tipo). */
export type ImportSource = {
  page(entity: PdPageEntity, start: number): Promise<PdPage>;
  pipelines(): Promise<PdItem[]>;
  stages(): Promise<PdItem[]>;
  activityTypes(): Promise<PdItem[]>;
  leadLabels(): Promise<PdItem[]>;
  dealFields(): Promise<PdFieldDef[]>;
  personFields(): Promise<PdFieldDef[]>;
  organizationFields(): Promise<PdFieldDef[]>;
};

/** Gravação e leitura do banco usadas pelo motor (implementação real em store.ts). */
export type ImportStore = {
  loadJob(id: string): Promise<JobRecord | null>;
  /** concessão exclusiva do job por `seconds` (import_claim); false se outra fatia a detém */
  claim(id: string, token: string, seconds: number): Promise<boolean>;
  release(id: string, token: string): Promise<void>;
  /** draft/running -> running; false se o job não pode rodar */
  start(id: string): Promise<boolean>;
  /**
   * Grava o cursor se a concessão é de `token` e o job está running ou paused (o trabalho da unidade já foi
   * feito); devolve false se o job não está mais running ou a concessão foi perdida.
   */
  saveCursor(id: string, token: string, cursor: ImportCursor): Promise<boolean>;
  /** encerra só se a concessão é de `token` */
  finish(id: string, token: string, status: "done" | "failed"): Promise<void>;
  upsert(id: string, entity: DbEntity, rows: Row[]): Promise<UpsertCounts>;
  /** soma created/updated/skipped/unchanged (errors e warnings o banco já conta) */
  count(id: string, entity: string, counts: Omit<UpsertCounts, "errors">): Promise<void>;
  log(id: string, items: LogItem[]): Promise<void>;
  rebuildDerivatives(id: string): Promise<void>;
  members(companyIds: string[]): Promise<MembersInfo>;
  customFieldDefs(companyIds: string[]): Promise<CustomFieldDef[]>;
  createCustomFieldDef(def: NewCustomFieldDef): Promise<void>;
  setCustomFieldOptions(id: string, options: string[]): Promise<void>;
  /** funil com este nome na empresa, arquivado ou não, com todas as etapas */
  findPipeline(companyId: string, name: string): Promise<ExistingPipeline | null>;
  createPipeline(companyId: string, name: string): Promise<string>;
  createStage(pipelineId: string, companyId: string, stage: { name: string; position: number; probability: number }): Promise<string>;
};

export type EngineDeps = { client: ImportSource; store: ImportStore; now?: () => number; token?: () => string };
export type SliceResult = {
  status: JobStatus;
  step: Step;
  counters: Record<string, Record<string, number>>;
  /** true quando não há mais o que rodar agora (done, failed ou paused) */
  done: boolean;
  /** outra fatia está com a concessão do job (em andamento): nada rodou nesta chamada */
  busy?: boolean;
};

/** Duração da concessão: maior que o orçamento padrão (40s) mais uma unidade. */
export const LEASE_SECONDS = 120;

const PAGE_STEPS: Partial<Record<Step, { source: PdPageEntity; entity: DbEntity }>> = {
  products: { source: "products", entity: "products" },
  organizations: { source: "organizations", entity: "organizations" },
  persons: { source: "persons", entity: "persons" },
  leads: { source: "leads", entity: "leads" },
  archived_leads: { source: "archivedLeads", entity: "leads" },
  deals: { source: "deals", entity: "deals" },
  activities: { source: "activities", entity: "activities" },
  notes: { source: "notes", entity: "notes" },
};
const INDEX_SOURCES = ["deals", "leads", "archivedLeads"] as const;
const CHUNK = 200;

/** Falha de configuração: o job vai para failed com a mensagem. */
class StepFailure extends Error {}

// ---- contexto ----------------------------------------------------------------------------------------------------

type Meta = Pick<MapCtx, "fieldOptions" | "fieldTypes" | "activityTypeNames" | "leadLabelNames">;

export type ImportEnv = {
  mappings: ImportMappings;
  /** empresas de destino: funis não ignorados, etiquetas de lead e empresa padrão */
  companies: string[];
  meta(): Promise<Meta>;
  members(): Promise<MembersInfo>;
};

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function targetCompanies(m: ImportMappings): string[] {
  const pipes = Object.entries(m.pipelines)
    .filter(([id]) => !m.ignorePipelines.includes(id))
    .map(([, p]) => p.companyId);
  return uniq([...pipes, ...Object.values(m.leadLabelCompany), m.defaultCompanyId]);
}

/**
 * Valida os mapeamentos e prepara, por chamada, o que os mapeadores precisam. Metadados do Pipedrive
 * (opções e tipos de campo, tipos de atividade, etiquetas) e membros das empresas são lidos sob demanda e
 * guardados só em memória; os índices de vínculo vêm de cursor.cache.
 */
export function prepareContext(job: JobRecord, deps: EngineDeps): ImportEnv {
  const parsed = ImportMappings.safeParse(job.mappings);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "raiz"}: ${i.message}`);
    throw new StepFailure(`Mapeamentos inválidos: ${issues.join("; ")}`);
  }
  const mappings = parsed.data;
  const companies = targetCompanies(mappings);
  let meta: Promise<Meta> | null = null;
  let members: Promise<MembersInfo> | null = null;
  return {
    mappings,
    companies,
    meta: () => (meta ??= loadMeta(deps.client)),
    members: () => (members ??= deps.store.members(companies)),
  };
}

async function loadMeta(client: ImportSource): Promise<Meta> {
  const [types, labels, dealFields, personFields, orgFields] = await Promise.all([
    client.activityTypes(),
    client.leadLabels(),
    client.dealFields(),
    client.personFields(),
    client.organizationFields(),
  ]);
  const fieldOptions: Record<string, Record<string, string>> = {};
  const fieldTypes: Record<string, string> = {};
  for (const f of [...dealFields, ...personFields, ...orgFields]) {
    fieldTypes[f.key] = f.field_type;
    if (f.options?.length) fieldOptions[f.key] = Object.fromEntries(f.options.map((o) => [String(o.id), o.label]));
  }
  const activityTypeNames: Record<string, string> = {};
  for (const t of types) if (typeof t.key_string === "string") activityTypeNames[t.key_string] = String(t.name ?? "");
  const leadLabelNames: Record<string, string> = {};
  for (const l of labels) if (refId(l.id)) leadLabelNames[refId(l.id)!] = String(l.name ?? "");
  return { fieldOptions, fieldTypes, activityTypeNames, leadLabelNames };
}

function emptyCache(companies: string[]): ImportCache {
  return { companies: [...companies], deals: {}, ignoredDeals: {}, leads: {}, contacts: {}, dealOwners: {} };
}

function companyIdx(cache: ImportCache, id: string): number {
  let i = cache.companies.indexOf(id);
  if (i < 0) i = cache.companies.push(id) - 1;
  return i;
}

function contactCompanies(cache: ImportCache, key: string, fallback: string): string[] {
  const idx = cache.contacts[key];
  return idx?.length ? idx.map((i) => cache.companies[i]) : [fallback];
}

/**
 * Empresa de atividade/anotação: negócio ou lead vinculado; senão as empresas da pessoa (as da organização só
 * quando não há pessoa). null = vinculada a negócio de funil ignorado ou sem mapeamento: pular.
 */
function recordCompanies(item: PdItem, cache: ImportCache, fallback: string): string[] | null {
  const deal = refId(item.deal_id);
  if (deal && cache.ignoredDeals?.[deal]) return null;
  if (deal && cache.deals[deal] !== undefined) return [cache.companies[cache.deals[deal]]];
  const lead = refId(item.lead_id);
  if (lead && cache.leads[lead] !== undefined) return [cache.companies[cache.leads[lead]]];
  const person = refId(item.person_id);
  if (person) return contactCompanies(cache, `person:${person}`, fallback);
  const org = refId(item.org_id);
  return org ? contactCompanies(cache, `org:${org}`, fallback) : [fallback];
}

/** customFieldKey -> tipo, para uma empresa e entidade */
function typesFor(cache: ImportCache, company: string, entity: string): Record<string, OxynFieldType> {
  const prefix = `${cache.companies.indexOf(company)}:${entity}:`;
  const out: Record<string, OxynFieldType> = {};
  for (const [k, t] of Object.entries(cache.fieldTypes ?? {})) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = t;
  return out;
}

// ---- etapas ------------------------------------------------------------------------------------------------------

function nextStep(step: Step): Step {
  return STEPS[Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1)];
}

function advance(cache: ImportCache, step: Step): ImportCursor {
  return { step: nextStep(step), start: 0, cache };
}

async function indexPage(env: ImportEnv, cursor: ImportCursor, client: ImportSource): Promise<ImportCursor> {
  const m = env.mappings;
  const sub = cursor.sub ?? 0;
  const start = cursor.start ?? 0;
  // começo do índice: sempre do zero
  const cache = cursor.cache && (sub > 0 || start > 0) ? cursor.cache : emptyCache(env.companies);
  const source = INDEX_SOURCES[sub];
  const page = await client.page(source, start);
  const add = (map: Record<string, number[]>, key: string, ci: number) => {
    const list = (map[key] ??= []);
    if (!list.includes(ci)) list.push(ci);
  };
  const link = (kind: string, id: string | null, ci: number) => id && add(cache.contacts, `${kind}:${id}`, ci);
  for (const item of page.items) {
    const id = refId(item.id);
    if (!id) continue;
    if (source === "deals") {
      const p = refId(item.pipeline_id);
      const pm = p ? m.pipelines[p] : undefined;
      if (!p || !pm || m.ignorePipelines.includes(p)) {
        cache.ignoredDeals[id] = 1;
        continue;
      }
      const ci = companyIdx(cache, pm.companyId);
      cache.deals[id] = ci;
      link("person", refId(item.person_id), ci);
      link("org", refId(item.org_id), ci);
      const owner = refId(item.owner_id ?? item.user_id);
      if (owner) add(cache.dealOwners, owner, ci);
    } else {
      const ci = companyIdx(cache, leadCompany(item, m));
      cache.leads[id] = ci;
      link("person", refId(item.person_id), ci);
      link("org", refId(item.organization_id ?? item.org_id), ci);
    }
  }
  if (page.nextStart !== null) return { step: "index", cache, sub, start: page.nextStart };
  if (sub + 1 < INDEX_SOURCES.length) return { step: "index", cache, sub: sub + 1, start: 0 };
  return advance(cache, "index");
}

/**
 * O dono padrão precisa de acesso ativo a todas as empresas de destino; o dono (mapeado) de cada negócio de funil
 * mapeado precisa de acesso à empresa desse funil. Lista os pares (usuário, empresa) que faltam.
 */
async function usersCheck(env: ImportEnv, cursor: ImportCursor): Promise<ImportCursor> {
  const cache = cursor.cache ?? emptyCache(env.companies);
  const { active, userNames, companyNames } = await env.members();
  const m = env.mappings;
  const pairs = new Map<string, string>();
  const need = (user: string, company: string) => {
    if (!active[company]?.includes(user)) {
      pairs.set(`${user}:${company}`, `${userNames[user] || user} (${companyNames[company] || company})`);
    }
  };
  for (const c of env.companies) need(m.fallbackOwnerId, c);
  for (const [pdUser, idx] of Object.entries(cache.dealOwners ?? {})) {
    const user = m.users[pdUser] ?? m.fallbackOwnerId;
    for (const i of idx) need(user, cache.companies[i]);
  }
  if (pairs.size) {
    throw new StepFailure(`Usuários sem acesso ativo à empresa de destino: ${[...pairs.values()].join("; ")}`);
  }
  return advance(cache, "users_check");
}

/** Tipos do Pipedrive -> tipo do campo no Oxyn (fase 2: text, number, money, date, select, multiselect, user). */
const FIELD_TYPE: Record<string, OxynFieldType> = {
  varchar: "text",
  varchar_auto: "text",
  text: "text",
  enum: "select",
  set: "multiselect",
  double: "number",
  int: "number",
  monetary: "number",
  date: "date",
  user: "user",
};
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** "Nome", "Nome (2)", "Nome (3)"... sempre dentro do limite de tamanho. */
function variant(base: string, n: number, max: number): string {
  const suffix = n === 1 ? "" : ` (${n})`;
  return base.slice(0, max - suffix.length).trimEnd() + suffix;
}

async function resolvePipelines(env: ImportEnv, client: ImportSource, store: ImportStore) {
  const m = env.mappings;
  const pending = Object.entries(m.pipelines).filter(([id, p]) => !m.ignorePipelines.includes(id) && !p.pipelineId);
  const resolved: NonNullable<ImportCache["pipelines"]> = {};
  if (!pending.length) return resolved;
  const [pdPipes, pdStages] = await Promise.all([client.pipelines(), client.stages()]);
  const claimed = new Set<string>(); // "<empresa>:<nome>" já usado nesta etapa

  for (const [pdId, pm] of pending) {
    const raw = pdPipes.find((p) => refId(p.id) === pdId)?.name;
    const base = typeof raw === "string" && raw.trim() ? raw.trim() : `Funil ${pdId}`;
    let pipelineId = "";
    let existing: ExistingPipeline | null = null;
    // funil ativo com o nome é reaproveitado; nome de funil arquivado ou já usado ganha sufixo
    for (let n = 1; !pipelineId; n++) {
      const name = variant(base, n, 80);
      if (claimed.has(`${pm.companyId}:${name}`)) continue;
      const found = await store.findPipeline(pm.companyId, name);
      if (found?.archived) continue;
      claimed.add(`${pm.companyId}:${name}`);
      existing = found;
      pipelineId = found?.id ?? (await store.createPipeline(pm.companyId, name));
    }

    const current = [...(existing?.stages ?? [])];
    let position = current.reduce((max, s) => Math.max(max, s.position), -1);
    const used = new Set<string>();
    const stages: Record<string, string> = {};
    const list = pdStages
      .filter((s) => refId(s.pipeline_id) === pdId)
      .sort((a, b) => Number(a.order_nr ?? 0) - Number(b.order_nr ?? 0));
    for (const s of list) {
      const sid = refId(s.id);
      if (!sid || pm.stages[sid]) continue;
      const sbase = typeof s.name === "string" && s.name.trim() ? s.name.trim() : `Etapa ${sid}`;
      const prob = Math.min(100, Math.max(0, Math.round(Number(s.deal_probability ?? 0)) || 0));
      for (let n = 1; !stages[sid]; n++) {
        const name = variant(sbase, n, 60);
        if (used.has(name)) continue;
        const found = current.find((x) => x.name === name);
        if (found?.archived) continue;
        used.add(name);
        if (found) {
          stages[sid] = found.id;
        } else {
          position += 1;
          stages[sid] = await store.createStage(pipelineId, pm.companyId, { name, position, probability: prob });
          current.push({ id: stages[sid], name, position, archived: false });
        }
      }
    }
    resolved[pdId] = { pipelineId, stages };
  }
  return resolved;
}

async function customFields(env: ImportEnv, cursor: ImportCursor, deps: EngineDeps, jobId: string): Promise<ImportCursor> {
  const { client, store } = deps;
  const m = env.mappings;
  const cache = cursor.cache ?? emptyCache(env.companies);
  cache.pipelines = await resolvePipelines(env, client, store);

  const wanted = Object.entries(m.customFields).filter(([, t]) => t.target === "custom" && t.customFieldKey);
  const fieldTypes: Record<string, OxynFieldType> = {};
  if (wanted.length) {
    const [dealFields, personFields, orgFields] = await Promise.all([
      client.dealFields(),
      client.personFields(),
      client.organizationFields(),
    ]);
    const dealCompanies = uniq(
      Object.entries(m.pipelines).filter(([id]) => !m.ignorePipelines.includes(id)).map(([, p]) => p.companyId),
    );
    const leadCompanies = uniq([...Object.values(m.leadLabelCompany), m.defaultCompanyId]);
    const defs = await store.customFieldDefs(env.companies);
    const errors: LogItem[] = [];

    for (const [pdKey, target] of wanted) {
      const key = target.customFieldKey!;
      if (!FIELD_KEY.test(key)) {
        errors.push({ entity: "custom_fields", external_id: pdKey, reason: `chave de campo inválida: ${key}` });
        continue;
      }
      let field: PdFieldDef | undefined;
      let entities: Record<string, string[]> = {};
      if ((field = dealFields.find((f) => f.key === pdKey))) entities = { deals: dealCompanies, leads: leadCompanies };
      else if ((field = personFields.find((f) => f.key === pdKey))) entities = { persons: env.companies };
      else if ((field = orgFields.find((f) => f.key === pdKey))) entities = { organizations: env.companies };
      if (!field) {
        errors.push({ entity: "custom_fields", external_id: pdKey, reason: "campo não encontrado no Pipedrive" });
        continue;
      }
      const options = uniq((field.options ?? []).map((o) => String(o.label ?? "").trim()).filter(Boolean));
      let type = FIELD_TYPE[field.field_type] ?? "text";
      if ((type === "select" || type === "multiselect") && !options.length) type = "text";
      const label = (field.name ?? "").trim().slice(0, 60) || key;

      for (const company of env.companies) {
        for (const [entity, companies] of Object.entries(entities)) {
          if (!companies.includes(company)) continue;
          const slot = `${companyIdx(cache, company)}:${entity}:${key}`;
          const found = defs.find((d) => d.company_id === company && d.entity === entity && d.key === key);
          if (found) {
            fieldTypes[slot] = found.type as OxynFieldType;
            if ((found.type === "select" || found.type === "multiselect") && options.some((o) => !found.options.includes(o))) {
              found.options = uniq([...found.options, ...options]);
              await store.setCustomFieldOptions(found.id, found.options);
            }
          } else {
            const def = { company_id: company, entity, key, label, type, options: type === "select" || type === "multiselect" ? options : [] };
            await store.createCustomFieldDef(def);
            defs.push({ ...def, id: "" });
            fieldTypes[slot] = type;
          }
        }
      }
    }
    if (errors.length) await store.log(jobId, errors);
  }
  cache.fieldTypes = fieldTypes;
  return advance(cache, "custom_fields");
}

/** null = pular o item (conta como skipped) */
function mapItem(step: Step, item: PdItem, env: ImportEnv, base: MapCtx, cache: ImportCache): MapResult[] | null {
  const m = env.mappings;
  const fallback = m.defaultCompanyId;
  const ctxFor = (companyId: string, entity: string): MapCtx => ({
    ...base,
    companyId,
    oxynFieldTypes: typesFor(cache, companyId, entity),
  });
  switch (step) {
    case "products":
      return [mapProduct(item, ctxFor(fallback, "products"))];
    case "organizations":
      return contactCompanies(cache, `org:${refId(item.id)}`, fallback).map((c) => mapOrganization(item, ctxFor(c, "organizations")));
    case "persons":
      return contactCompanies(cache, `person:${refId(item.id)}`, fallback).map((c) => mapPerson(item, ctxFor(c, "persons")));
    case "leads":
    case "archived_leads":
      return [mapLead(item, { ...ctxFor(leadCompany(item, m), "leads"), archived: step === "archived_leads" })];
    case "deals": {
      const p = refId(item.pipeline_id);
      if (p && m.ignorePipelines.includes(p)) return null;
      const company = p ? m.pipelines[p]?.companyId : undefined;
      return [mapDeal(item, company ? ctxFor(company, "deals") : base)];
    }
    case "activities":
    case "notes": {
      const companies = recordCompanies(item, cache, fallback);
      if (!companies) return null;
      const fn = step === "activities" ? mapActivity : mapNote;
      return companies.map((c) => fn(item, ctxFor(c, step)));
    }
    default:
      return null;
  }
}

async function entityPage(env: ImportEnv, cursor: ImportCursor, deps: EngineDeps, jobId: string): Promise<ImportCursor> {
  const step = cursor.step!;
  const spec = PAGE_STEPS[step]!;
  const cache = cursor.cache ?? emptyCache(env.companies);
  const page = await deps.client.page(spec.source, cursor.start ?? 0);
  const [meta, members] = await Promise.all([env.meta(), env.members()]);
  const base: MapCtx = { mappings: env.mappings, ...meta, resolvedPipelines: cache.pipelines };
  const fallbackOwner = env.mappings.fallbackOwnerId;
  const isContact = step === "organizations" || step === "persons";
  const rows: Row[] = [];
  const logs: LogItem[] = [];
  let skipped = 0;

  for (const item of page.items) {
    const ext = refId(item.id);
    const results = mapItem(step, item, env, base, cache);
    if (!results) {
      skipped++;
      continue;
    }
    let failed = false;
    for (const [i, r] of results.entries()) {
      if (!r.ok) {
        // a mesma falha se repetiria em cada empresa: registra uma vez
        if (!failed) logs.push({ entity: spec.entity, external_id: ext, reason: r.error });
        failed = true;
        continue;
      }
      const row = { ...r.row };
      for (const w of r.warnings) logs.push({ entity: spec.entity, external_id: ext, reason: `aviso: ${w}` });
      // cópia de contato em empresa secundária: dono sem acesso a ela vira o dono padrão (aviso agregado)
      const company = typeof row.company_id === "string" ? row.company_id : null;
      if (isContact && i > 0 && company && typeof row.owner_id === "string" && !members.active[company]?.includes(row.owner_id)) {
        const k = `${row.owner_id}:${companyIdx(cache, company)}`;
        cache.ownerSwaps = { ...cache.ownerSwaps, [k]: (cache.ownerSwaps?.[k] ?? 0) + 1 };
        row.owner_id = fallbackOwner;
      }
      rows.push(row);
    }
  }

  const total = { created: 0, updated: 0, skipped, unchanged: 0 };
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await deps.store.upsert(jobId, spec.entity, rows.slice(i, i + CHUNK));
    total.created += res.created ?? 0;
    total.updated += res.updated ?? 0;
    total.skipped += res.skipped ?? 0;
    total.unchanged += res.unchanged ?? 0;
  }
  const last = page.nextStart === null;
  if (last && cache.ownerSwaps) {
    for (const [k, n] of Object.entries(cache.ownerSwaps)) {
      const [user, ci] = k.split(":");
      const company = cache.companies[Number(ci)];
      logs.push({
        entity: spec.entity,
        external_id: null,
        reason: `aviso: ${members.userNames[user] || user} sem acesso à empresa ${members.companyNames[company] || company}; dono padrão usado em ${n} ${n === 1 ? "registro" : "registros"}`,
      });
    }
    delete cache.ownerSwaps;
  }
  if (logs.length) await deps.store.log(jobId, logs);
  if (rows.length || skipped) await deps.store.count(jobId, spec.entity, total);

  return last ? advance(cache, step) : { step, cache, start: page.nextStart! };
}

async function runUnit(env: ImportEnv, cursor: ImportCursor, deps: EngineDeps, jobId: string): Promise<ImportCursor> {
  const step = cursor.step ?? STEPS[0];
  const c = { ...cursor, step };
  switch (step) {
    case "index":
      return indexPage(env, c, deps.client);
    case "users_check":
      return usersCheck(env, c);
    case "custom_fields":
      return customFields(env, c, deps, jobId);
    case "derivatives":
      await deps.store.rebuildDerivatives(jobId);
      return advance(c.cache ?? emptyCache(env.companies), step);
    case "done":
      return c;
    default:
      return entityPage(env, c, deps, jobId);
  }
}

// ---- fatia -------------------------------------------------------------------------------------------------------

function resultOf(job: JobRecord): SliceResult {
  return {
    status: job.status,
    step: job.cursor?.step ?? STEPS[0],
    counters: job.counters ?? {},
    done: job.status !== "running",
  };
}

async function reload(store: ImportStore, jobId: string): Promise<SliceResult> {
  const job = await store.loadJob(jobId);
  if (!job) throw new Error("Importação não encontrada");
  return resultOf(job);
}

/**
 * Roda o job por no máximo ~budgetMs (sempre ao menos uma unidade: uma página ou uma etapa curta), com a
 * concessão exclusiva do job. O cursor é gravado após cada unidade; rodar de novo a partir dele não duplica
 * (import_upsert é idempotente).
 */
export async function runImportSlice(
  jobId: string,
  { budgetMs = 40_000, deps }: { budgetMs?: number; deps: EngineDeps },
): Promise<SliceResult> {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const t0 = now();
  const job = await store.loadJob(jobId);
  if (!job) throw new Error("Importação não encontrada");
  if (job.status !== "draft" && job.status !== "running") return resultOf(job);

  const token = deps.token?.() ?? crypto.randomUUID();
  if (!(await store.claim(jobId, token, LEASE_SECONDS))) {
    // outra fatia está rodando este job: em andamento, nada a fazer agora
    return { ...resultOf(job), status: "running", done: false, busy: true };
  }
  try {
    if (!(await store.start(jobId))) return await reload(store, jobId);
    let cursor: ImportCursor = { ...(job.cursor ?? {}), step: job.cursor?.step ?? STEPS[0] };
    try {
      const env = prepareContext(job, deps);
      for (;;) {
        if (cursor.step === "done") {
          await store.finish(jobId, token, "done");
          break;
        }
        const u0 = now();
        cursor = await runUnit(env, cursor, deps, jobId);
        const unitMs = now() - u0;
        if (!(await store.saveCursor(jobId, token, cursor))) break; // pausado ou concessão perdida
        if (cursor.step === "done") continue;
        // para antes de estourar: a próxima unidade deve levar o mesmo que a última
        if (now() - t0 + unitMs >= budgetMs) break;
      }
    } catch (e) {
      if (e instanceof PipedriveAuthError || e instanceof StepFailure) {
        await store.log(jobId, [{ entity: "job", external_id: null, reason: e.message }]);
        await store.finish(jobId, token, "failed");
      } else {
        const current = await store.loadJob(jobId);
        // pausado no meio da página (import_upsert recusa job fora de running): para sem erro
        if (current && current.status !== "running") return resultOf(current);
        // outros erros: o job continua running e retoma do último cursor gravado
        throw e;
      }
    }
    return await reload(store, jobId);
  } finally {
    await store.release(jobId, token).catch(() => {}); // se falhar, a concessão vence sozinha
  }
}

/** Roda fatias até o job sair de running (script de linha de comando). */
export async function runImportToEnd(
  jobId: string,
  deps: EngineDeps,
  onSlice?: (r: SliceResult) => void,
  budgetMs?: number,
): Promise<SliceResult> {
  for (;;) {
    const r = await runImportSlice(jobId, { budgetMs, deps });
    onSlice?.(r);
    if (r.busy) throw new Error("Outra execução está processando esta importação. Tente de novo em instantes.");
    if (r.done) return r;
  }
}

// ---- simulação ---------------------------------------------------------------------------------------------------

/**
 * Armazenamento de simulação: lê o job e os dados de apoio do armazenamento real, mas mantém tudo o que seria
 * gravado (status, cursor, contadores, campos, funis e linhas) só em memória.
 */
export function createDryRunStore(base: ImportStore) {
  let job: JobRecord | null = null;
  const rows: Partial<Record<DbEntity, number>> = {};
  const logs: LogItem[] = [];
  const defs: CustomFieldDef[] = [];
  const pipes: (ExistingPipeline & { company_id: string; name: string })[] = [];
  let seq = 0;
  const bump = (entity: string, key: string, n: number) => {
    if (!job) return;
    const cur = { ...(job.counters[entity] ?? {}) };
    cur[key] = (cur[key] ?? 0) + n;
    job.counters = { ...job.counters, [entity]: cur };
  };
  const store: ImportStore = {
    async loadJob(id) {
      job ??= await base.loadJob(id);
      return job && structuredClone(job);
    },
    async claim() {
      return true;
    },
    async release() {},
    async start() {
      if (!job || (job.status !== "draft" && job.status !== "running")) return false;
      job.status = "running";
      return true;
    },
    async saveCursor(_id, _token, cursor) {
      if (!job || (job.status !== "running" && job.status !== "paused")) return false;
      job.cursor = structuredClone(cursor);
      return job.status === "running";
    },
    async finish(_id, _token, status) {
      if (job) job.status = status;
    },
    async upsert(_id, entity, list) {
      rows[entity] = (rows[entity] ?? 0) + list.length;
      return { created: list.length, updated: 0, skipped: 0, unchanged: 0, errors: 0 };
    },
    async count(_id, entity, counts) {
      for (const [k, v] of Object.entries(counts)) bump(entity, k, v);
    },
    async log(_id, items) {
      logs.push(...items);
      for (const i of items) bump(i.entity, i.reason.startsWith("aviso:") ? "warnings" : "errors", 1);
    },
    async rebuildDerivatives() {},
    members: (ids) => base.members(ids),
    async customFieldDefs(ids) {
      return [...(await base.customFieldDefs(ids)), ...defs.filter((d) => ids.includes(d.company_id))];
    },
    async createCustomFieldDef(def) {
      defs.push({ id: `dry-${++seq}`, company_id: def.company_id, entity: def.entity, key: def.key, type: def.type, options: def.options });
    },
    async setCustomFieldOptions() {},
    async findPipeline(companyId, name) {
      return pipes.find((p) => p.company_id === companyId && p.name === name) ?? (await base.findPipeline(companyId, name));
    },
    async createPipeline(companyId, name) {
      const id = `dry-${++seq}`;
      pipes.push({ id, company_id: companyId, name, archived: false, stages: [] });
      return id;
    },
    async createStage(pipelineId, _companyId, stage) {
      const id = `dry-${++seq}`;
      pipes.find((p) => p.id === pipelineId)?.stages.push({ id, name: stage.name, position: stage.position, archived: false });
      return id;
    },
  };
  return { store, rows, logs };
}
