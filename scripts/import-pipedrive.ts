// Roda uma importação do Pipedrive até o fim: pnpm import:pipedrive <jobId> [--dry-run]
// --dry-run lê o Pipedrive e o job e mapeia tudo, sem gravar nada no banco. Em rascunho, valida e converte o
// rascunho como a simulação do assistente. A importação real só roda em job já iniciado pelo assistente.
// O token vem de PIPEDRIVE_API_TOKEN (.env.local) e nunca é impresso.
import { loadEnv } from "./load-env";
import { createAdminClient } from "../src/lib/supabase/admin";
import { createPipedriveClient } from "../src/lib/import/pipedrive/client";
import { prepareCliRun } from "../src/lib/import/cli";
import { loadDiscovery } from "../src/lib/import/discovery";
import { runImportToEnd, type SliceResult } from "../src/lib/import/engine";
import { createSupabaseStore } from "../src/lib/import/store";

loadEnv();

function summary(r: SliceResult): string {
  const parts = Object.entries(r.counters).map(
    ([entity, c]) =>
      `${entity}: ${["created", "updated", "unchanged", "skipped", "errors", "warnings"]
        .filter((k) => c[k])
        .map((k) => `${k}=${c[k]}`)
        .join(" ")}`,
  );
  return `[${r.status}] etapa ${r.step}${parts.length ? ` | ${parts.join(" | ")}` : ""}`;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const jobId = args.find((a) => !a.startsWith("--"));
  if (!jobId) {
    console.error("Uso: pnpm import:pipedrive <jobId> [--dry-run]");
    process.exit(1);
  }
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) {
    console.error("PIPEDRIVE_API_TOKEN ausente. Defina em .env.local.");
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios em .env.local.");
    process.exit(1);
  }

  const client = createPipedriveClient({ token, baseUrl: process.env.PIPEDRIVE_BASE_URL || undefined });
  const real = createSupabaseStore(createAdminClient());
  const prepared = await prepareCliRun(jobId, { store: real, dryRun, discover: loadDiscovery });
  if (!prepared.ok) {
    console.error(prepared.error);
    process.exit(1);
  }
  const { dry } = prepared;
  if (dryRun) console.log("Simulação: nada será gravado no banco.");

  let last = "";
  const r = await runImportToEnd(jobId, { client, store: prepared.store }, (s) => {
    const line = summary(s);
    if (line !== last) console.log(line);
    last = line;
  });
  if (dry) {
    console.log(`Linhas mapeadas: ${JSON.stringify(dry.rows)}`);
    for (const l of dry.logs.slice(0, 20)) console.log(`- ${l.entity} ${l.external_id ?? ""}: ${l.reason}`);
    if (dry.logs.length > 20) console.log(`... e mais ${dry.logs.length - 20} itens no log`);
  }
  if (r.status !== "done") process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
