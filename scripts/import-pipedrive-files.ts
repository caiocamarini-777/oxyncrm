// Importa do Pipedrive os e-mails guardados lá e os arquivos (anexos reais e arquivos dos cards):
// pnpm import:pipedrive-arquivos
// Reexecutável: e-mails, vínculos e arquivos já importados são pulados pelo id do Pipedrive, então dá para rodar de
// novo no dia da virada para trazer o que chegou nesse meio-tempo. Anexos dentro do corpo (assinaturas) e convites
// .ics ficam de fora; arquivos que são links entram só como link; acima de 25 MB entra só o nome.
// --simular só conta o que seria importado (não grava nada nem baixa arquivos).
// O token vem de PIPEDRIVE_API_TOKEN e nunca é impresso.
import { loadEnv } from "./load-env";
import { createAdminClient } from "../src/lib/supabase/admin";
import { createPipedriveClient } from "../src/lib/import/pipedrive/client";
import { runMailImport } from "../src/lib/import/pipedrive-mail/run";
import { supabaseMailStore } from "../src/lib/import/pipedrive-mail/store";

loadEnv();

const MAX_ERRORS_SHOWN = 20;

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--simular");
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error("PIPEDRIVE_API_TOKEN ausente.");

  const client = createPipedriveClient({ token, baseUrl: process.env.PIPEDRIVE_BASE_URL || undefined });
  console.log(dryRun ? "Simulação: nada será gravado." : "Importando e-mails e arquivos do Pipedrive.");
  const r = await runMailImport({ client, store: supabaseMailStore(createAdminClient()), log: console.log }, { dryRun });

  const e = r.emails;
  const f = r.files;
  console.log("");
  console.log("E-mails");
  console.log(`  novos: ${e.created}  já existentes: ${e.existing}  vínculos novos: ${e.links}  sem registro no CRM: ${e.noRecord}`);
  console.log("Arquivos");
  console.log(`  enviados: ${f.uploaded}  links: ${f.remote}  só o nome (> 25 MB): ${f.tooLarge}  já existentes: ${f.existing}`);
  console.log(
    `  pulados: ${f.skippedInline} dentro do corpo, ${f.skippedIcs} convites .ics, ${f.noTarget} sem card, ${f.noEmail} de e-mail não importado`,
  );

  if (r.errors.length) {
    console.error(`\n${r.errors.length} erro(s). Rode de novo para tentar outra vez.`);
    for (const err of r.errors.slice(0, MAX_ERRORS_SHOWN)) console.error(`  ${err.item}: ${err.reason}`);
    if (r.errors.length > MAX_ERRORS_SHOWN) console.error(`  ... e mais ${r.errors.length - MAX_ERRORS_SHOWN}.`);
    process.exit(1);
  }
  if (dryRun) console.log("\nSimulação: nada foi gravado.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
