// Preenche o rascunho da carga inicial com os padrões da Oxyn (conta Itaú PJ, regra "confirm",
// categoria de serviço por cliente): pnpm financeiro:fill <rascunho.json> [saida.json] [--company oxyn]
// Não toca o banco: só grava o JSON que o pnpm import:financeiro lê.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fillDefaults } from "../src/lib/finance/import/fill-defaults";
import { financeImportDraftSchema, financeImportSchema } from "../src/lib/finance/import/schema";

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--company");
  const company = i >= 0 ? args[i + 1] : "oxyn";
  const [input, output = "scripts/.tmp/financeiro/final.json"] = args.filter((_, j) => i < 0 || (j !== i && j !== i + 1));
  if (!input || !company) {
    console.error("Uso: pnpm financeiro:fill <rascunho.json> [saida.json] [--company oxyn]");
    process.exit(1);
  }
  const draft = financeImportDraftSchema.partial({ warnings: true }).parse(JSON.parse(readFileSync(input, "utf8")));
  const filled = fillDefaults(draft, company);
  const check = financeImportSchema.safeParse(filled);
  if (!check.success) {
    for (const issue of check.error.issues) console.error(`- ${issue.message}`);
    throw new Error("O JSON preenchido ainda não passa na validação do import.");
  }
  const out = resolve(process.cwd(), output);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(filled, null, 2) + "\n");
  console.log(`Gravado ${out} (empresa ${company}; ${filled.contracts.length} contratos, ${filled.entries.length} lançamentos)`);
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
