import "server-only";
import { createDryRunStore, type ImportStore, type LogItem } from "./engine";
import { DraftMappings, toMappings, validateDraft, type Discovery } from "./wizard";

export const CLI_ERRORS = {
  notFound: "Importação não encontrada.",
  draft: "Esta importação ainda está em rascunho. Inicie a importação pelo assistente (que valida os mapeamentos) e rode o comando de novo, ou use --dry-run para simular.",
  invalidDraft: "Mapeamento do rascunho em formato inválido.",
};

export type CliRun =
  | { ok: true; store: ImportStore; dry: { rows: Partial<Record<string, number>>; logs: LogItem[] } | null }
  | { ok: false; error: string };

/**
 * Prepara o armazenamento do script de linha de comando. Importação real só para job já iniciado pelo assistente.
 * Simulação de rascunho: valida e converte o rascunho como a simulação do assistente (validateDraft + toMappings),
 * sem alterar o job no banco.
 */
export async function prepareCliRun(
  jobId: string,
  opts: {
    store: ImportStore;
    dryRun: boolean;
    discover: () => Promise<{ ok: true; data: Discovery } | { ok: false; error: string }>;
  },
): Promise<CliRun> {
  const { store, dryRun } = opts;
  const job = await store.loadJob(jobId);
  if (!job) return { ok: false, error: CLI_ERRORS.notFound };
  if (job.status !== "draft") {
    if (!dryRun) return { ok: true, store, dry: null };
    const dry = createDryRunStore(store);
    return { ok: true, store: dry.store, dry };
  }
  if (!dryRun) return { ok: false, error: CLI_ERRORS.draft };

  const draft = DraftMappings.safeParse(job.mappings);
  if (!draft.success) return { ok: false, error: CLI_ERRORS.invalidDraft };
  const discovery = await opts.discover();
  if (!discovery.ok) return { ok: false, error: discovery.error };
  const problems = validateDraft(draft.data, discovery.data);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const mappings = toMappings(draft.data);
  if (!mappings.ok) return { ok: false, error: mappings.error };
  // o job lido pela simulação usa os mapeamentos finais (o rascunho no banco não muda)
  const base: ImportStore = {
    ...store,
    loadJob: async (id) => {
      const j = await store.loadJob(id);
      return j && { ...j, mappings: mappings.mappings, cursor: {}, counters: {} };
    },
  };
  const dry = createDryRunStore(base);
  return { ok: true, store: dry.store, dry };
}
