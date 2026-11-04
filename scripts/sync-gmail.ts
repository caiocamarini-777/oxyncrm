// Sincroniza as caixas Gmail conectadas (a mesma rotina do cron /api/cron/gmail): pnpm sync:gmail [minutos]
// Útil para fazer a primeira carga de 12 meses sem esperar os ciclos de 5 minutos. O orçamento padrão é de
// 10 minutos. Tokens e conteúdo dos e-mails nunca são impressos.
import { loadEnv } from "./load-env";
import { gmailConfig } from "../src/lib/gmail/oauth";
import { runGmailSync } from "../src/lib/gmail/run";
import { createAdminClient } from "../src/lib/supabase/admin";

loadEnv();

async function main() {
  if (!gmailConfig()) throw new Error("Integração com o Gmail não configurada (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_TOKEN_KEY).");
  const minutes = Number(process.argv[2] ?? 10);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Uso: pnpm sync:gmail [minutos]");
  const outcomes = await runGmailSync(createAdminClient(), { budgetMs: minutes * 60_000 });
  if (outcomes.length === 0) console.log("Nenhuma caixa ativa.");
  for (const o of outcomes) {
    if (o.status === "ok") {
      console.log(`${o.email}: ${o.phase}, ${o.processed} lidas, ${o.stored} gravadas, ${o.linked} vínculos, ${o.errors} erros${o.complete ? "" : " (incompleta)"}`);
    } else {
      console.log(`${o.email}: ${o.status}${"error" in o && o.error ? ` (${o.error})` : ""}`);
    }
  }
  if (outcomes.some((o) => o.status === "error")) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
