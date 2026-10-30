// Extrai o rascunho da carga inicial do Financeiro: pnpm financeiro:extract <planilha.xlsx> [saida.json]
// O rascunho sai com endRule, categoria de serviço, conta e companySlug vazios: preencha antes do import.
// A planilha real é dado privado: o rascunho fica em scripts/.tmp/financeiro/ (fora do git).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { extractWorkbook } from "../src/lib/finance/import/extract";

async function main() {
  const [input, output = "scripts/.tmp/financeiro/draft.json"] = process.argv.slice(2);
  if (!input) {
    console.error("Uso: pnpm financeiro:extract <planilha.xlsx> [saida.json]");
    process.exit(1);
  }
  const draft = await extractWorkbook(readFileSync(input));
  const out = resolve(process.cwd(), output);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(draft, null, 2) + "\n");

  console.log(`Rascunho gravado em ${out}`);
  console.log(
    `Contratos: ${draft.contracts.length} | Despesas recorrentes: ${draft.recurringExpenses.length} | ` +
      `Lançamentos: ${draft.entries.length} (liquidados ${draft.entries.filter((e) => e.status === "settled").length}, ` +
      `em aberto ${draft.entries.filter((e) => e.status === "open").length})`,
  );
  for (const [month, v] of Object.entries(draft.check)) {
    console.log(`Conferência ${month}: entradas ${v.in.toFixed(2)} | saídas ${v.out.toFixed(2)}`);
  }
  if (draft.warnings.length > 0) {
    console.log(`\nAvisos (${draft.warnings.length}):`);
    for (const w of draft.warnings) console.log(`- ${w}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
