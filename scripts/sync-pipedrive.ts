// Sincronização diária com o Pipedrive (origem dos dados até a migração): pnpm sync:pipedrive
// Cria uma importação nova com os mapeamentos da última importação concluída e a roda até o fim. Funis e etiquetas de
// lead de empresas apagadas do CRM são ignorados, assim como os contatos ligados só a eles. Registros que já
// vieram do Pipedrive são atualizados (o vínculo fica em external_ids); os novos são criados.
// Sem --espelho, edições feitas no CRM são preservadas e nada é apagado.
// Com --espelho (até desligar o Pipedrive), o CRM fica igual ao Pipedrive: o Pipedrive sobrescreve edições do CRM e,
// no fim, vai para a lixeira o que a sincronização não viu (criado só no CRM ou apagado no Pipedrive). Se algum tipo
// de registro perderia mais de 5% de uma vez, nada é apagado e o script falha. --sem-trava tira o limite;
// --simular só conta o que seria apagado.
// Depois rode pnpm import:pipedrive-etapas para refazer o histórico de etapas.
// O token vem de PIPEDRIVE_API_TOKEN e nunca é impresso.
import { loadEnv } from "./load-env";
import { createAdminClient } from "../src/lib/supabase/admin";
import { createPipedriveClient } from "../src/lib/import/pipedrive/client";
import { runImportToEnd } from "../src/lib/import/engine";
import { pruneMissingCompanies } from "../src/lib/import/mapping";
import { ImportMappings } from "../src/lib/import/pipedrive/types";
import { createSupabaseStore } from "../src/lib/import/store";

loadEnv();

const MAX_PRUNE_RATIO = 0.05;

type PruneResult = { counts: Record<string, { apagar: number; total: number }>; blocked: string[]; applied: boolean };

async function main() {
  const args = new Set(process.argv.slice(2));
  const mirror = args.has("--espelho");
  const simulate = args.has("--simular");
  const noLimit = args.has("--sem-trava");
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error("PIPEDRIVE_API_TOKEN ausente.");
  const admin = createAdminClient();

  const { data: last, error } = await admin
    .from("import_jobs")
    .select("id, mappings, created_by")
    .eq("source", "pipedrive")
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível ler as importações: ${error.message}`);
  if (!last) throw new Error("Nenhuma importação concluída para copiar os mapeamentos. Faça a primeira pelo assistente.");

  // empresas apagadas do CRM: o funil e as etiquetas de lead delas passam a ser ignorados
  const { data: companies, error: companiesError } = await admin.from("companies").select("id");
  if (companiesError) throw new Error(`Não foi possível ler as empresas: ${companiesError.message}`);
  const { mappings, removed } = pruneMissingCompanies(ImportMappings.parse(last.mappings), new Set(companies.map((c) => c.id)));
  if (removed.length) console.log(`Ignorando ${removed.length} empresa(s) que não existe(m) mais no CRM.`);

  const { data: job, error: insertError } = await admin
    .from("import_jobs")
    .insert({ source: "pipedrive", status: "running", mappings, created_by: last.created_by, mirror })
    .select("id")
    .single();
  if (insertError || !job) throw new Error(`Não foi possível criar a importação: ${insertError?.message}`);
  console.log(`Importação ${job.id} (mapeamentos de ${last.id})${mirror ? ", modo espelho" : ""}.`);

  const client = createPipedriveClient({ token, baseUrl: process.env.PIPEDRIVE_BASE_URL || undefined });
  const r = await runImportToEnd(job.id, { client, store: createSupabaseStore(createAdminClient()) });
  for (const [entity, c] of Object.entries(r.counters)) {
    const parts = ["created", "updated", "unchanged", "skipped", "errors", "warnings"].filter((k) => c[k]).map((k) => `${k}=${c[k]}`);
    if (parts.length) console.log(`${entity}: ${parts.join(" ")}`);
  }
  console.log(`Status: ${r.status}`);
  if (r.status !== "done") process.exit(1);
  if (mirror) await prune(admin, job.id, { simulate, noLimit });
}

// Lixeira para o que a sincronização não viu. Só depois de uma importação concluída por inteiro.
async function prune(
  admin: ReturnType<typeof createAdminClient>,
  jobId: string,
  opts: { simulate: boolean; noLimit: boolean },
) {
  const { data, error } = await admin.rpc("import_mirror_prune", {
    p_job: jobId,
    p_max_ratio: opts.noLimit ? null : MAX_PRUNE_RATIO,
    p_apply: !opts.simulate,
  });
  if (error) throw new Error(`Não foi possível limpar o espelho: ${error.message}`);
  const r = data as PruneResult;
  for (const [entity, c] of Object.entries(r.counts)) {
    if (c.apagar) console.log(`${entity}: ${c.apagar} de ${c.total} ${r.applied ? "foram para a lixeira" : "iriam para a lixeira"}`);
  }
  if (r.blocked.length) {
    console.error(
      `Nada foi apagado: ${r.blocked.join(", ")} perderia(m) mais de ${MAX_PRUNE_RATIO * 100}% de uma vez. ` +
        "Confira o Pipedrive e, se estiver certo, rode à mão com --espelho --sem-trava.",
    );
    process.exit(1);
  }
  if (!r.applied) console.log("Simulação: nada foi apagado.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
