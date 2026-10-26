"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createCompany } from "@/lib/companies/actions";
import { slugify } from "@/lib/companies/slug";
import type { ActionResult } from "@/lib/db-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import {
  SIMULATION_TOTAL_MS,
  SLICE_BUDGET_MS,
  continueJob,
  isTransientError,
  simulateUntil,
  type ContinueResult,
} from "./continue";
import { createDryRunStore, runImportSlice, type LogItem } from "./engine";
import { loadDiscovery, PIPEDRIVE_MESSAGES, pipedriveErrorMessage, pipedriveFromEnv } from "./discovery";
import { loadOxynData } from "./queries";
import { createSupabaseStore } from "./store";
import { DraftMappings, suggestDraft, toMappings, validateDraft } from "./wizard";

const PATH = "/configuracoes/importacao";

type Counters = Record<string, Record<string, number>>;
export type { ContinueResult };

const NOT_FOUND = { ok: false as const, error: "Importação não encontrada." };

async function jobStatus(id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  const supabase = await createServerClient();
  const { data } = await supabase.from("import_jobs").select("status").eq("id", id).maybeSingle();
  return data?.status ?? null;
}

/** Nova importação em rascunho: com as sugestões do Pipedrive, ou com os mapeamentos de outra importação. */
export async function createImportJob(copyFrom?: string): Promise<ActionResult<{ id: string }>> {
  const profile = await requireSuperAdmin();
  const supabase = await createServerClient();
  let mappings: DraftMappings;
  if (copyFrom) {
    if (!isUuid(copyFrom)) return NOT_FOUND;
    const { data } = await supabase.from("import_jobs").select("mappings").eq("id", copyFrom).maybeSingle();
    const parsed = DraftMappings.safeParse(data?.mappings);
    if (!parsed.success) return NOT_FOUND;
    mappings = parsed.data;
  } else {
    const discovery = await loadDiscovery();
    if (!discovery.ok) return { ok: false, error: discovery.error };
    mappings = suggestDraft(discovery.data, await loadOxynData(), profile.id);
  }
  const { data, error } = await supabase
    .from("import_jobs")
    .insert({ source: "pipedrive", status: "draft", mappings })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Não foi possível criar a importação. Tente de novo." };
  revalidatePath(PATH);
  return { ok: true, data: { id: data.id } };
}

/** Grava o rascunho (só enquanto a importação está em rascunho). */
export async function saveMappings(jobId: string, mappings: DraftMappings): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = DraftMappings.safeParse(mappings);
  if (!parsed.success) return { ok: false, error: "Mapeamento em formato inválido." };
  if (!isUuid(jobId)) return NOT_FOUND;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("import_jobs")
    .update({ mappings: parsed.data })
    .eq("id", jobId)
    .eq("status", "draft")
    .select("id");
  if (error) return { ok: false, error: "Não foi possível salvar o mapeamento." };
  if (!data?.length) return { ok: false, error: "Esta importação já foi iniciada e não pode mais ser alterada." };
  return { ok: true, data: undefined };
}

/**
 * "Criar empresa com este nome": usa a mesma criação de Configurações > Empresas (o banco semeia funil, tipos,
 * canais e resultados padrão). Ninguém é adicionado como membro: o admin geral já tem acesso a todas.
 */
export async function createImportCompany(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  await requireSuperAdmin();
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 80);
  if (clean.length < 2) return { ok: false, error: "O nome da empresa precisa de ao menos 2 caracteres." };
  const base = slugify(clean) || "empresa";
  for (let n = 1; n <= 20; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const res = await createCompany({ name: clean, slug });
    if (res.ok) {
      const supabase = await createServerClient();
      const { data } = await supabase.from("companies").select("id, name").eq("slug", res.data.slug).single();
      if (!data) break;
      return { ok: true, data: { id: data.id, name: data.name } };
    }
    if (res.fieldErrors?.slug !== "Este endereço já está em uso.") return { ok: false, error: res.error };
  }
  return { ok: false, error: "Não foi possível criar a empresa." };
}

/** Valida o rascunho e coloca a importação em andamento (a tela de progresso roda as fatias). */
export async function startImport(jobId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!isUuid(jobId)) return NOT_FOUND;
  const supabase = await createServerClient();
  const { data: job } = await supabase.from("import_jobs").select("status, mappings").eq("id", jobId).maybeSingle();
  if (!job) return NOT_FOUND;
  if (job.status !== "draft") return { ok: false, error: "Esta importação já foi iniciada." };
  const draft = DraftMappings.safeParse(job.mappings);
  if (!draft.success) return { ok: false, error: "Mapeamento em formato inválido." };
  const discovery = await loadDiscovery();
  if (!discovery.ok) return { ok: false, error: discovery.error };
  const problems = validateDraft(draft.data, discovery.data);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const mappings = toMappings(draft.data);
  if (!mappings.ok) return { ok: false, error: mappings.error };
  const { data, error } = await supabase
    .from("import_jobs")
    .update({ status: "running", mappings: mappings.mappings })
    .eq("id", jobId)
    .eq("status", "draft")
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Não foi possível iniciar a importação." };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/**
 * Roda uma fatia (~10s mais uma unidade) com o cliente admin, só com o job em running. Pausado, concluído ou com
 * falha: devolve o estado atual. Rascunho: erro. busy = outra fatia está com a concessão do job.
 */
export async function continueImport(jobId: string): Promise<ContinueResult> {
  await requireSuperAdmin();
  if (!isUuid(jobId)) return NOT_FOUND;
  const store = createSupabaseStore(createAdminClient());
  try {
    return await continueJob(jobId, {
      load: async (id) => {
        const job = await store.loadJob(id);
        return job && { status: job.status, step: job.cursor?.step ?? "index", counters: job.counters ?? {} };
      },
      run: async (id) => {
        const client = pipedriveFromEnv();
        if (!client) throw new MissingToken();
        return runImportSlice(id, { budgetMs: SLICE_BUDGET_MS, deps: { client, store } });
      },
    });
  } catch (e) {
    if (e instanceof MissingToken) return { ok: false, error: PIPEDRIVE_MESSAGES.missing };
    // o job continua em andamento e retoma do último cursor gravado
    console.error("importação: falha na fatia", e instanceof Error ? e.message : e);
    return {
      ok: false,
      error: "A etapa atual falhou. A importação continua de onde parou ao tentar de novo.",
      transient: isTransientError(e),
    };
  }
}

class MissingToken extends Error {}

async function setStatus(jobId: string, from: string, to: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  if (!isUuid(jobId)) return false;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("import_jobs")
    .update({ status: to, ...extra })
    .eq("id", jobId)
    .eq("status", from)
    .select("id");
  return (data?.length ?? 0) > 0;
}

/** Pausa ao fim da unidade em curso. Se a importação já terminou (ou já está pausada), não há o que pausar. */
export async function pauseImport(jobId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (await setStatus(jobId, "running", "paused")) return { ok: true, data: undefined };
  const status = await jobStatus(jobId);
  if (!status) return NOT_FOUND;
  if (status === "draft") return { ok: false, error: "A importação ainda não foi iniciada." };
  return { ok: true, data: undefined };
}

export async function resumeImport(jobId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!(await setStatus(jobId, "paused", "running"))) return { ok: false, error: "A importação não está pausada." };
  return { ok: true, data: undefined };
}

/**
 * Importação que falhou volta para rascunho para revisar os mapeamentos (por exemplo, depois de dar acesso aos
 * usuários que faltavam). Começa do zero: os registros já gravados são reconhecidos pelo id externo e não duplicam.
 */
export async function reviseImport(jobId: string): Promise<ActionResult> {
  await requireSuperAdmin();
  const ok = await setStatus(jobId, "failed", "draft", {
    cursor: {},
    counters: {},
    errors: [],
    warnings: [],
    started_at: null,
    finished_at: null,
  });
  if (!ok) return { ok: false, error: "Só uma importação que falhou pode voltar para revisão." };
  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export type SimulationResult = {
  status: string;
  step: string;
  counters: Counters;
  /** parou no teto de tempo: contadores parciais */
  partial: boolean;
  message: string | null;
  logs: LogItem[];
  logTotal: number;
};

/** Simulação: lê o Pipedrive e mapeia tudo com o rascunho atual, sem gravar nada no banco. */
export async function simulateImport(jobId: string): Promise<ActionResult<SimulationResult>> {
  const t0 = Date.now();
  await requireSuperAdmin();
  if ((await jobStatus(jobId)) !== "draft") return { ok: false, error: "A simulação só roda em rascunho." };
  const client = pipedriveFromEnv();
  if (!client) return { ok: false, error: PIPEDRIVE_MESSAGES.missing };
  const discovery = await loadDiscovery();
  if (!discovery.ok) return { ok: false, error: discovery.error };
  const supabase = await createServerClient();
  const { data: job } = await supabase.from("import_jobs").select("mappings").eq("id", jobId).single();
  const draft = DraftMappings.safeParse(job?.mappings);
  if (!draft.success) return { ok: false, error: "Mapeamento em formato inválido." };
  const problems = validateDraft(draft.data, discovery.data);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const mappings = toMappings(draft.data);
  if (!mappings.ok) return { ok: false, error: mappings.error };

  const real = createSupabaseStore(createAdminClient());
  // o job lido pela simulação usa os mapeamentos finais (o rascunho no banco não muda)
  const base = { ...real, loadJob: async (id: string) => {
    const j = await real.loadJob(id);
    return j && { ...j, mappings: mappings.mappings, cursor: {}, counters: {} };
  } };
  const dry = createDryRunStore(base);
  try {
    // teto de ~45s contando desde o início da action (a página exporta maxDuration = 60)
    const r = await simulateUntil(
      (budgetMs) => runImportSlice(jobId, { budgetMs, deps: { client, store: dry.store } }),
      { totalMs: SIMULATION_TOTAL_MS - (Date.now() - t0) },
    );
    return { ok: true, data: { ...r, logs: dry.logs.slice(0, 200), logTotal: dry.logs.length } };
  } catch (e) {
    console.error("importação: falha na simulação", e instanceof Error ? e.message : e);
    return { ok: false, error: pipedriveErrorMessage(e) };
  }
}
