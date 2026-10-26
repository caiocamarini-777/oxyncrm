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
  "users_check",
  "index",
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
  /** id do lead -> empresa */
  leads: Record<string, number>;
  /** "person:12" / "org:5" -> empresas vistas pelos negócios e leads do contato */
  contacts: Record<string, number[]>;
  /** funis mapeados como null, criados na etapa custom_fields */
  pipelines?: Record<string, { pipelineId: string; stages: Record<string, string> }>;
  /** customFieldKey -> tipo do campo no Oxyn */
  fieldTypes?: Record<string, OxynFieldType>;
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
  /** draft/running -> running; false se o job não pode rodar */
  start(id: string): Promise<boolean>;
  /** grava o cursor se o job está running ou paused (o trabalho da unidade já foi feito); false se não está mais running */
  saveCursor(id: string, cursor: ImportCursor): Promise<boolean>;
  finish(id: string, status: "done" | "failed"): Promise<void>;
  upsert(id: string, entity: DbEntity, rows: Row[]): Promise<UpsertCounts>;
  /** soma created/updated/skipped/unchanged (errors e warnings o banco já conta) */
  count(id: string, entity: string, counts: Omit<UpsertCounts, "errors">): Promise<void>;
  log(id: string, items: LogItem[]): Promise<void>;
  rebuildDerivatives(id: string): Promise<void>;
  members(companyIds: string[]): Promise<MembersInfo>;
  customFieldDefs(companyIds: string[]): Promise<CustomFieldDef[]>;
  createCustomFieldDef(def: NewCustomFieldDef): Promise<void>;
  setCustomFieldOptions(id: string, options: string[]): Promise<void>;
  findPipeline(companyId: string, name: string): Promise<{ id: string; stages: { id: string; name: string }[] } | null>;
  createPipeline(companyId: string, name: string): Promise<string>;
  createStage(pipelineId: string, companyId: string, stage: { name: string; position: number; probability: number }): Promise<string>;
};

export type EngineDeps = { client: ImportSource; store: ImportStore; now?: () => number };
export type SliceResult = {
  status: JobStatus;
  step: Step;
  counters: Record<string, Record<string, number>>;
  /** true quando não há mais o que rodar agora (done, failed ou paused) */
  done: boolean;
};

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
  return { companies: [...companies], deals: {}, leads: {}, contacts: {} };
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

/** Empresa de atividade/anotação: negócio ou lead vinculado; senão as empresas da pessoa e da organização. */
function recordCompanies(item: PdItem, cache: ImportCache, fallback: string): string[] {
  const deal = refId(item.deal_id);
  if (deal && cache.deals[deal] !== undefined) return [cache.companies[cache.deals[deal]]];
  const lead = refId(item.lead_id);
  if (lead && cache.leads[lead] !== undefined) return [cache.companies[cache.leads[lead]]];
  const person = refId(item.person_id);
  const org = refId(item.org_id);
  const out = uniq([
    ...(person ? contactCompanies(cache, `person:${person}`, fallback) : []),
    ...(org ? contactCompanies(cache, `org:${org}`, fallback) : []),
  ]);
  return out.length ? out : [fallback];
}

// ---- etapas ------------------------------------------------------------------------------------------------------

function nextStep(step: Step): Step {
  return STEPS[Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1)];
}

function advance(cursor: ImportCursor, step: Step): ImportCursor {
  return { step: nextStep(step), start: 0, cache: cursor.cache };
}

async function usersCheck(env: ImportEnv): Promise<ImportCursor> {
  const { active, userNames, companyNames } = await env.members();
  const m = env.mappings;
  const name = (id: string) => userNames[id] || id;
  const missing: string[] = [];
  const noAccess = env.companies.filter((c) => !active[c]?.includes(m.fallbackOwnerId));
  if (noAccess.length) missing.push(`${name(m.fallbackOwnerId)} (${noAccess.map((c) => companyNames[c] || c).join(", ")})`);
  for (const user of uniq(Object.values(m.users))) {
    if (user === m.fallbackOwnerId) continue;
    if (!env.companies.some((c) => active[c]?.includes(user))) missing.push(`${name(user)} (nenhuma empresa de destino)`);
  }
  if (missing.length) {
    throw new StepFailure(`Usuários mapeados sem acesso ativo às empresas de destino: ${missing.join("; ")}`);
  }
  return { step: "index", start: 0, sub: 0, cache: emptyCache(env.companies) };
}

async function indexPage(env: ImportEnv, cursor: ImportCursor, client: ImportSource): Promise<ImportCursor> {
  const m = env.mappings;
  const cache = cursor.cache ?? emptyCache(env.companies);
  const sub = cursor.sub ?? 0;
  const source = INDEX_SOURCES[sub];
  const page = await client.page(source, cursor.start ?? 0);
  const link = (key: string, id: string | null, ci: number) => {
    if (!id) return;
    const list = (cache.contacts[`${key}:${id}`] ??= []);
    if (!list.includes(ci)) list.push(ci);
  };
  for (const item of page.items) {
    const id = refId(item.id);
    if (!id) continue;
    if (source === "deals") {
      const p = refId(item.pipeline_id);
      const pm = p ? m.pipelines[p] : undefined;
      if (!p || !pm || m.ignorePipelines.includes(p)) continue;
      const ci = companyIdx(cache, pm.companyId);
      cache.deals[id] = ci;
      link("person", refId(item.person_id), ci);
      link("org", refId(item.org_id), ci);
    } else {
      const ci = companyIdx(cache, leadCompany(item, m));
      cache.leads[id] = ci;
      link("person", refId(item.person_id), ci);
      link("org", refId(item.organization_id ?? item.org_id), ci);
    }
  }
  if (page.nextStart !== null) return { ...cursor, cache, start: page.nextStart };
  if (sub + 1 < INDEX_SOURCES.length) return { ...cursor, cache, sub: sub + 1, start: 0 };
  return advance({ cache }, "index");
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

async function resolvePipelines(env: ImportEnv, client: ImportSource, store: ImportStore) {
  const m = env.mappings;
  const pending = Object.entries(m.pipelines).filter(([id, p]) => !m.ignorePipelines.includes(id) && !p.pipelineId);
  const resolved: NonNullable<ImportCache["pipelines"]> = {};
  if (!pending.length) return resolved;
  const [pdPipes, pdStages] = await Promise.all([client.pipelines(), client.stages()]);
  for (const [pdId, pm] of pending) {
    const raw = pdPipes.find((p) => refId(p.id) === pdId)?.name;
    const name = (typeof raw === "string" && raw.trim() ? raw.trim() : `Funil ${pdId}`).slice(0, 80);
    const existing = await store.findPipeline(pm.companyId, name);
    const pipelineId = existing?.id ?? (await store.createPipeline(pm.companyId, name));
    const stages: Record<string, string> = {};
    const list = pdStages
      .filter((s) => refId(s.pipeline_id) === pdId)
      .sort((a, b) => Number(a.order_nr ?? 0) - Number(b.order_nr ?? 0));
    for (const [position, s] of list.entries()) {
      const sid = refId(s.id);
      if (!sid || pm.stages[sid]) continue;
      const sname = (typeof s.name === "string" && s.name.trim() ? s.name.trim() : `Etapa ${sid}`).slice(0, 60);
      const found = existing?.stages.find((x) => x.name === sname);
      const prob = Math.min(100, Math.max(0, Math.round(Number(s.deal_probability ?? 0)) || 0));
      stages[sid] = found?.id ?? (await store.createStage(pipelineId, pm.companyId, { name: sname, position, probability: prob }));
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
          const found = defs.find((d) => d.company_id === company && d.entity === entity && d.key === key);
          if (found) {
            fieldTypes[key] ??= found.type as OxynFieldType;
            if ((found.type === "select" || found.type === "multiselect") && options.some((o) => !found.options.includes(o))) {
              found.options = uniq([...found.options, ...options]);
              await store.setCustomFieldOptions(found.id, found.options);
            }
          } else {
            const def = { company_id: company, entity, key, label, type, options: type === "select" || type === "multiselect" ? options : [] };
            await store.createCustomFieldDef(def);
            defs.push({ ...def, id: "" });
            fieldTypes[key] ??= type;
          }
        }
      }
    }
    if (errors.length) await store.log(jobId, errors);
  }
  cache.fieldTypes = fieldTypes;
  return advance({ cache }, "custom_fields");
}

type Mapped = { results: MapResult[]; skipped: boolean };

function mapItem(step: Step, item: PdItem, env: ImportEnv, ctx: MapCtx, cache: ImportCache): Mapped {
  const m = env.mappings;
  const fallback = m.defaultCompanyId;
  const perCompany = (companies: string[], fn: (i: PdItem, c: MapCtx) => MapResult) =>
    companies.map((companyId) => fn(item, { ...ctx, companyId }));
  switch (step) {
    case "products":
      return { results: [mapProduct(item, { ...ctx, companyId: fallback })], skipped: false };
    case "organizations":
      return { results: perCompany(contactCompanies(cache, `org:${refId(item.id)}`, fallback), mapOrganization), skipped: false };
    case "persons":
      return { results: perCompany(contactCompanies(cache, `person:${refId(item.id)}`, fallback), mapPerson), skipped: false };
    case "leads":
      return { results: [mapLead(item, ctx)], skipped: false };
    case "archived_leads":
      return { results: [mapLead(item, { ...ctx, archived: true })], skipped: false };
    case "deals": {
      const p = refId(item.pipeline_id);
      if (p && m.ignorePipelines.includes(p)) return { results: [], skipped: true };
      return { results: [mapDeal(item, ctx)], skipped: false };
    }
    case "activities":
      return { results: perCompany(recordCompanies(item, cache, fallback), mapActivity), skipped: false };
    case "notes":
      return { results: perCompany(recordCompanies(item, cache, fallback), mapNote), skipped: false };
    default:
      return { results: [], skipped: true };
  }
}

async function entityPage(env: ImportEnv, cursor: ImportCursor, deps: EngineDeps, jobId: string): Promise<ImportCursor> {
  const step = cursor.step!;
  const spec = PAGE_STEPS[step]!;
  const cache = cursor.cache ?? emptyCache(env.companies);
  const page = await deps.client.page(spec.source, cursor.start ?? 0);
  const [meta, members] = await Promise.all([env.meta(), env.members()]);
  const ctx: MapCtx = {
    mappings: env.mappings,
    ...meta,
    resolvedPipelines: cache.pipelines,
    oxynFieldTypes: cache.fieldTypes,
  };
  const fallbackOwner = env.mappings.fallbackOwnerId;
  const rows: Row[] = [];
  const logs: LogItem[] = [];
  let skipped = 0;

  for (const item of page.items) {
    const ext = refId(item.id);
    const { results, skipped: skip } = mapItem(step, item, env, ctx, cache);
    if (skip) {
      skipped++;
      continue;
    }
    let failed = false;
    for (const r of results) {
      if (!r.ok) {
        // a mesma falha se repetiria em cada empresa: registra uma vez
        if (!failed) logs.push({ entity: spec.entity, external_id: ext, reason: r.error });
        failed = true;
        continue;
      }
      const row = { ...r.row };
      for (const w of r.warnings) logs.push({ entity: spec.entity, external_id: ext, reason: `aviso: ${w}` });
      const company = typeof row.company_id === "string" ? row.company_id : null;
      if (company && typeof row.owner_id === "string" && row.owner_id !== fallbackOwner && !members.active[company]?.includes(row.owner_id)) {
        logs.push({
          entity: spec.entity,
          external_id: ext,
          reason: `aviso: dono ${members.userNames[row.owner_id] || row.owner_id} sem acesso à empresa ${members.companyNames[company] || company}; usado o dono padrão`,
        });
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
  if (logs.length) await deps.store.log(jobId, logs);
  if (rows.length || skipped) await deps.store.count(jobId, spec.entity, total);

  if (page.nextStart !== null) return { ...cursor, cache, start: page.nextStart };
  return advance({ cache }, step);
}

async function runUnit(env: ImportEnv, cursor: ImportCursor, deps: EngineDeps, jobId: string): Promise<ImportCursor> {
  const step = cursor.step ?? "users_check";
  const c = { ...cursor, step };
  switch (step) {
    case "users_check":
      return usersCheck(env);
    case "index":
      return indexPage(env, c, deps.client);
    case "custom_fields":
      return customFields(env, c, deps, jobId);
    case "derivatives":
      await deps.store.rebuildDerivatives(jobId);
      return advance(c, step);
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
    step: job.cursor?.step ?? "users_check",
    counters: job.counters ?? {},
    done: job.status !== "running",
  };
}

async function reload(store: ImportStore, jobId: string): Promise<SliceResult> {
  const job = await store.loadJob(jobId);
  if (!job) throw new Error("Importação não encontrada");
  return resultOf(job);
}

async function fail(store: ImportStore, jobId: string, reason: string) {
  await store.log(jobId, [{ entity: "job", external_id: null, reason }]);
  await store.finish(jobId, "failed");
}

/**
 * Roda o job por no máximo ~budgetMs (sempre ao menos uma unidade: uma página ou uma etapa curta).
 * O cursor é gravado após cada unidade; rodar de novo a partir dele não duplica (import_upsert é idempotente).
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
  if (!(await store.start(jobId))) return reload(store, jobId);

  let cursor: ImportCursor = { ...(job.cursor ?? {}), step: job.cursor?.step ?? "users_check" };
  try {
    const env = prepareContext(job, deps);
    for (;;) {
      if (cursor.step === "done") {
        await store.finish(jobId, "done");
        break;
      }
      const u0 = now();
      cursor = await runUnit(env, cursor, deps, jobId);
      const unitMs = now() - u0;
      if (!(await store.saveCursor(jobId, cursor))) break; // pausado
      if (cursor.step === "done") continue;
      // para antes de estourar: a próxima unidade deve levar o mesmo que a última
      if (now() - t0 + unitMs >= budgetMs) break;
    }
  } catch (e) {
    if (e instanceof PipedriveAuthError || e instanceof StepFailure) {
      await fail(store, jobId, e.message);
    } else {
      const current = await store.loadJob(jobId);
      // pausado no meio da página (import_upsert recusa job fora de running): para sem erro
      if (current && current.status !== "running") return resultOf(current);
      throw e;
    }
  }
  return reload(store, jobId);
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
  const pipes: { id: string; company_id: string; name: string; stages: { id: string; name: string }[] }[] = [];
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
    async start() {
      if (!job || (job.status !== "draft" && job.status !== "running")) return false;
      job.status = "running";
      return true;
    },
    async saveCursor(_id, cursor) {
      if (!job || (job.status !== "running" && job.status !== "paused")) return false;
      job.cursor = structuredClone(cursor);
      return job.status === "running";
    },
    async finish(_id, status) {
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
      pipes.push({ id, company_id: companyId, name, stages: [] });
      return id;
    },
    async createStage(pipelineId, _companyId, stage) {
      const id = `dry-${++seq}`;
      pipes.find((p) => p.id === pipelineId)?.stages.push({ id, name: stage.name });
      return id;
    },
  };
  return { store, rows, logs };
}
