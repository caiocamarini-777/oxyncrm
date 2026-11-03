// Sincronização diária com o Pipedrive (origem dos dados até a migração): pnpm sync:pipedrive
// Cria uma importação nova com os mapeamentos da última importação concluída e a roda até o fim. Registros que já
// vieram do Pipedrive são atualizados (o vínculo fica em external_ids); os novos são criados. Nada é apagado.
// Depois rode pnpm import:pipedrive-etapas para refazer o histórico de etapas.
// O token vem de PIPEDRIVE_API_TOKEN e nunca é impresso.
import { loadEnv } from "./load-env";
import { createAdminClient } from "../src/lib/supabase/admin";
import { createPipedriveClient } from "../src/lib/import/pipedrive/client";
import { runImportToEnd } from "../src/lib/import/engine";
import { createSupabaseStore } from "../src/lib/import/store";

loadEnv();

async function main() {
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

  const { data: job, error: insertError } = await admin
    .from("import_jobs")
    .insert({ source: "pipedrive", status: "running", mappings: last.mappings, created_by: last.created_by })
    .select("id")
    .single();
  if (insertError || !job) throw new Error(`Não foi possível criar a importação: ${insertError?.message}`);
  console.log(`Importação ${job.id} (mapeamentos de ${last.id}).`);

  const client = createPipedriveClient({ token, baseUrl: process.env.PIPEDRIVE_BASE_URL || undefined });
  const r = await runImportToEnd(job.id, { client, store: createSupabaseStore(createAdminClient()) });
  for (const [entity, c] of Object.entries(r.counters)) {
    const parts = ["created", "updated", "unchanged", "skipped", "errors", "warnings"].filter((k) => c[k]).map((k) => `${k}=${c[k]}`);
    if (parts.length) console.log(`${entity}: ${parts.join(" ")}`);
  }
  console.log(`Status: ${r.status}`);
  if (r.status !== "done") process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
