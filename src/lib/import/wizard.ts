// Assistente de importação: sugestões, validação e rótulos. Puro (sem servidor), usado pela página e pelas actions.
import { z } from "zod";
import { ImportMappings } from "./pipedrive/types";

// ---- dados que o assistente mostra -------------------------------------------------------------------------------

export type DiscoveredField = {
  key: string;
  name: string;
  type: string;
  entity: "deals" | "persons" | "organizations";
};

/** O que o assistente lê do Pipedrive (sem o token, sem dados de registros). */
export type Discovery = {
  pipelines: { id: string; name: string }[];
  stages: { id: string; pipelineId: string; name: string; order: number }[];
  users: { id: string; name: string; email: string; active: boolean }[];
  labels: { id: string; name: string }[];
  fields: DiscoveredField[];
};

export type OxynPipeline = { id: string; companyId: string; name: string; stages: { id: string; name: string }[] };

export type OxynData = {
  companies: { id: string; name: string }[];
  pipelines: OxynPipeline[];
  profiles: { id: string; name: string; email: string }[];
};

// ---- rascunho ----------------------------------------------------------------------------------------------------

export const FIELD_TARGETS = ["native:setup_total", "native:mrr", "native:contract_months", "custom"] as const;
export type FieldTarget = (typeof FIELD_TARGETS)[number];

/** Mesmo formato de ImportMappings, mas com campos ainda vazios (""). Fica em import_jobs.mappings. */
export const DraftMappings = z.object({
  pipelines: z.record(
    z.string(),
    z.object({
      companyId: z.string(),
      pipelineId: z.string().nullable(),
      stages: z.record(z.string(), z.string().nullable()),
    }),
  ),
  users: z.record(z.string(), z.string()),
  fallbackOwnerId: z.string(),
  leadLabelCompany: z.record(z.string(), z.string()),
  defaultCompanyId: z.string(),
  customFields: z.record(
    z.string(),
    z.object({ target: z.enum(FIELD_TARGETS), customFieldKey: z.string().optional() }),
  ),
  ignorePipelines: z.array(z.string()),
});
export type DraftMappings = z.infer<typeof DraftMappings>;

export function emptyDraft(): DraftMappings {
  return {
    pipelines: {},
    users: {},
    fallbackOwnerId: "",
    leadLabelCompany: {},
    defaultCompanyId: "",
    customFields: {},
    ignorePipelines: [],
  };
}

// ---- sugestões ---------------------------------------------------------------------------------------------------

/** Sem acento, minúsculo, espaços simples. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NATIVE_BY_NAME: Record<string, FieldTarget> = {
  setup: "native:setup_total",
  "mrr contratado": "native:mrr",
  "prazo (meses)": "native:contract_months",
};

export const NATIVE_LABELS: Record<Exclude<FieldTarget, "custom">, string> = {
  "native:setup_total": "Setup",
  "native:mrr": "MRR",
  "native:contract_months": "Prazo do contrato (meses)",
};

export function suggestFieldTarget(name: string): FieldTarget {
  return NATIVE_BY_NAME[norm(name)] ?? "custom";
}

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export function fieldKeyFrom(name: string): string {
  let key = norm(name)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) return "campo";
  if (!/^[a-z]/.test(key)) key = `campo_${key}`;
  return key.slice(0, 40).replace(/_+$/, "");
}

/** Campos personalizados do Pipedrive: edit_flag ou chave hash de 40 caracteres. */
export function isCustomField(f: { key: string; edit_flag?: unknown }): boolean {
  return f.edit_flag === true || /^[0-9a-f]{40}$/.test(f.key);
}

/** Etapas do funil do Pipedrive -> etapas do funil existente, pelo nome (sem destino quando não casa). */
export function stagesFor(
  pdPipelineId: string,
  discovery: Discovery,
  target: OxynPipeline | undefined,
): Record<string, string | null> {
  if (!target) return {};
  const out: Record<string, string | null> = {};
  for (const s of discovery.stages.filter((x) => x.pipelineId === pdPipelineId)) {
    out[s.id] = target.stages.find((t) => norm(t.name) === norm(s.name))?.id ?? null;
  }
  return out;
}

/** Destino de um funil numa empresa: funil com o mesmo nome, senão criar. */
export function pipelineTarget(
  pdPipelineId: string,
  companyId: string,
  discovery: Discovery,
  oxyn: OxynData,
): DraftMappings["pipelines"][string] {
  const name = discovery.pipelines.find((p) => p.id === pdPipelineId)?.name ?? "";
  const existing = companyId
    ? oxyn.pipelines.find((p) => p.companyId === companyId && norm(p.name) === norm(name))
    : undefined;
  return { companyId, pipelineId: existing?.id ?? null, stages: stagesFor(pdPipelineId, discovery, existing) };
}

export function suggestDraft(discovery: Discovery, oxyn: OxynData, fallbackOwnerId: string): DraftMappings {
  const companyByName = (name: string) => oxyn.companies.find((c) => norm(c.name) === norm(name))?.id ?? "";
  const draft = emptyDraft();
  draft.fallbackOwnerId = fallbackOwnerId;
  for (const p of discovery.pipelines) {
    draft.pipelines[p.id] = pipelineTarget(p.id, companyByName(p.name), discovery, oxyn);
  }
  for (const u of discovery.users) {
    const match = u.email ? oxyn.profiles.find((p) => p.email.toLowerCase() === u.email.trim().toLowerCase()) : undefined;
    if (match) draft.users[u.id] = match.id;
  }
  for (const l of discovery.labels) {
    const c = companyByName(l.name);
    if (c) draft.leadLabelCompany[l.id] = c;
  }
  for (const f of discovery.fields) {
    const target = f.entity === "deals" ? suggestFieldTarget(f.name) : "custom";
    draft.customFields[f.key] = target === "custom" ? { target, customFieldKey: fieldKeyFrom(f.name) } : { target };
  }
  return draft;
}

// ---- validação ---------------------------------------------------------------------------------------------------

const ENTITY_WORD: Record<DiscoveredField["entity"], string> = {
  deals: "negócio",
  persons: "pessoa",
  organizations: "organização",
};

/** Problemas do rascunho em português (vazio = pode iniciar). */
export function validateDraft(draft: DraftMappings, discovery: Discovery): string[] {
  const problems: string[] = [];
  for (const p of discovery.pipelines) {
    if (draft.ignorePipelines.includes(p.id)) continue;
    if (!draft.pipelines[p.id]?.companyId) {
      problems.push(`Escolha a empresa de destino do funil "${p.name.trim()}" ou marque para ignorar.`);
    }
  }
  if (!draft.defaultCompanyId) problems.push("Escolha a empresa padrão.");
  if (!draft.fallbackOwnerId) problems.push("Escolha o dono padrão.");

  const natives = new Map<string, number>();
  const keys = new Map<string, number>();
  for (const f of discovery.fields) {
    const t = draft.customFields[f.key];
    if (!t) continue;
    if (t.target === "custom") {
      const key = t.customFieldKey ?? "";
      if (!FIELD_KEY_RE.test(key)) {
        problems.push(`Chave inválida no campo "${f.name}": use letras minúsculas, números e _ (começando por letra).`);
      } else {
        const k = `${f.entity}:${key}`;
        keys.set(k, (keys.get(k) ?? 0) + 1);
      }
    } else if (f.entity !== "deals") {
      problems.push(`O campo "${f.name}" não é de ${ENTITY_WORD.deals} e não pode ir para um campo nativo.`);
    } else {
      natives.set(t.target, (natives.get(t.target) ?? 0) + 1);
    }
  }
  for (const [target, n] of natives) {
    if (n > 1) problems.push(`Mais de um campo vai para "${NATIVE_LABELS[target as keyof typeof NATIVE_LABELS]}". Escolha só um.`);
  }
  for (const [k, n] of keys) {
    const [entity, key] = k.split(":");
    if (n > 1) problems.push(`A chave "${key}" está repetida em campos de ${ENTITY_WORD[entity as DiscoveredField["entity"]]}.`);
  }
  return problems;
}

/** Rascunho -> ImportMappings (funis ignorados saem de pipelines). */
export function toMappings(draft: DraftMappings): { ok: true; mappings: ImportMappings } | { ok: false; error: string } {
  const pipelines = Object.fromEntries(
    Object.entries(draft.pipelines).filter(([id, p]) => !draft.ignorePipelines.includes(id) && p.companyId),
  );
  const parsed = ImportMappings.safeParse({ ...draft, pipelines });
  if (parsed.success) return { ok: true, mappings: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, error: `Mapeamento incompleto (${first.path.join(".") || "raiz"}): ${first.message}` };
}

// ---- rótulos -----------------------------------------------------------------------------------------------------

export const STEP_LABELS: Record<string, string> = {
  index: "Lendo vínculos",
  users_check: "Conferindo usuários",
  custom_fields: "Funis e campos",
  products: "Produtos",
  organizations: "Organizações",
  persons: "Pessoas",
  leads: "Leads",
  archived_leads: "Leads arquivados",
  deals: "Negócios",
  derivatives: "Histórico e receita dos negócios",
  activities: "Atividades",
  notes: "Anotações",
  done: "Fim",
};

export const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  running: "Em andamento",
  paused: "Pausada",
  done: "Concluída",
  failed: "Falhou",
};

export const ENTITY_LABELS: Record<string, string> = {
  job: "Importação",
  custom_fields: "Campos",
  products: "Produtos",
  organizations: "Organizações",
  persons: "Pessoas",
  leads: "Leads",
  deals: "Negócios",
  activities: "Atividades",
  notes: "Anotações",
};

export const COUNTER_KEYS = ["created", "updated", "unchanged", "skipped", "errors", "warnings"] as const;
export const COUNTER_LABELS: Record<(typeof COUNTER_KEYS)[number], string> = {
  created: "Criados",
  updated: "Atualizados",
  unchanged: "Sem mudança",
  skipped: "Ignorados",
  errors: "Erros",
  warnings: "Avisos",
};
