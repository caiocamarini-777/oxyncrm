// Piloto pós-virada: o CRM atualiza o Pipedrive. pnpm sync:crm-para-pipedrive
// Sem argumentos, roda uma rodada (até 50 min): copia para o Pipedrive o que foi criado, mudado ou apagado no CRM
// desde o cursor da última rodada. Com a rotina desligada, ou com o modo espelho ainda ativo, sai na hora (skipped).
//   --ligar     liga a rotina; o cursor começa no fim da última sincronização do Pipedrive.
//   --desligar  desliga a rotina (o cursor fica onde está).
//   --status    mostra a configuração, a última rodada e a fila de retry; não envia nada.
// Rode --ligar só depois da última sincronização sem espelho (pnpm sync:pipedrive sem --espelho).
// O token vem de PIPEDRIVE_API_TOKEN e nunca é impresso. Código de saída 1 se a rodada falhar.
import { loadEnv } from "./load-env";
import { createAdminClient } from "../src/lib/supabase/admin";
import { createPipedriveClient } from "../src/lib/import/pipedrive/client";
import { runPipedrivePush, type PushReport } from "../src/lib/pipedrive-push/run";
import { PUSH_ORDER, supabasePushStore, MIRROR_GUARD_MS } from "../src/lib/pipedrive-push/store";

loadEnv();

/** Tempo máximo de uma rodada: o workflow tem timeout de 55 min, e a rodada para sozinha antes. */
const BUDGET_MS = 50 * 60_000;
/** Linhas de erro e de fila de retry que o script lista (o resto fica só na contagem). */
const LIST_MAX = 20;
const FLAGS = ["--ligar", "--desligar", "--status"];

type Admin = ReturnType<typeof createAdminClient>;
type RunRow = {
  started_at: string;
  finished_at: string | null;
  cursor_from: string | null;
  cursor_to: string | null;
  status: string;
  counters: Record<string, Record<string, number>> | null;
  errors: { entity: string; id: string; reason: string }[] | null;
};

/** Data e hora no horário de Brasília, que é como a equipe lê o GitHub Actions. */
function when(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return `${d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília)`;
}

function printCounters(counters: Record<string, Record<string, number>> | null | undefined): void {
  for (const entity of PUSH_ORDER) {
    const c = counters?.[entity];
    if (!c) continue;
    const parts = (["created", "updated", "deleted", "errors"] as const).filter((k) => c[k]).map((k) => `${k}=${c[k]}`);
    if (parts.length) console.log(`  ${entity}: ${parts.join(" ")}`);
  }
}

function printErrors(errors: { entity: string; id: string; reason: string }[]): void {
  if (!errors.length) return;
  console.log(`Erros (${errors.length}):`);
  for (const e of errors.slice(0, LIST_MAX)) console.log(`  ${e.entity} ${e.id}: ${e.reason}`);
  if (errors.length > LIST_MAX) console.log(`  ... e mais ${errors.length - LIST_MAX} (o relatório completo fica em pipedrive_push_runs)`);
}

function printReport(r: PushReport): void {
  printCounters(r.counters);
  printErrors(r.errors);
  console.log(`Status: ${r.status}${r.reason ? ` (${r.reason})` : ""}`);
}

async function showStatus(admin: Admin, store: ReturnType<typeof supabasePushStore>): Promise<void> {
  const { data: settings, error } = await admin
    .from("pipedrive_push_settings")
    .select("enabled, enabled_at, cursor")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Não foi possível ler a configuração: ${error.message}`);
  console.log(`Rotina: ${settings?.enabled ? "ligada" : "desligada"}`);
  console.log(`  ligada em: ${when(settings?.enabled_at)}`);
  console.log(`  cursor (mudanças do CRM enviadas até): ${when(settings?.cursor)}`);
  const mirror = await store.mirrorActive(new Date());
  console.log(
    `Modo espelho: ${mirror ? `ATIVO (a última importação do Pipedrive foi espelho há menos de ${MIRROR_GUARD_MS / 3600_000} h; a rotina não roda)` : "inativo"}`,
  );

  const { data: last, error: lastError } = await admin
    .from("pipedrive_push_runs")
    .select("started_at, finished_at, cursor_from, cursor_to, status, counters, errors")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(`Não foi possível ler as rodadas: ${lastError.message}`);
  const run = last as RunRow | null;
  if (!run) {
    console.log("Última rodada: nenhuma ainda.");
  } else {
    console.log(`Última rodada: ${run.status}`);
    console.log(`  início: ${when(run.started_at)}`);
    console.log(`  fim: ${run.finished_at ? when(run.finished_at) : "não terminou (rodando agora, ou foi interrompida)"}`);
    console.log(`  cursor: ${when(run.cursor_from)} -> ${when(run.cursor_to)}`);
    printCounters(run.counters);
    printErrors(run.errors ?? []);
  }

  const { data: queue, count, error: queueError } = await admin
    .from("pipedrive_push_retry")
    .select("entity, record_id, attempts, last_error, updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .limit(LIST_MAX);
  if (queueError) throw new Error(`Não foi possível ler a fila de retry: ${queueError.message}`);
  console.log(`Fila de retry: ${count ?? queue?.length ?? 0} registro(s)`);
  for (const q of queue ?? []) {
    const reason = String(q.last_error ?? "").replace(/\s+/g, " ").slice(0, 160);
    console.log(`  ${q.entity} ${q.record_id}: ${q.attempts} tentativa(s)${reason ? `, ${reason}` : ""}`);
  }
  if ((count ?? 0) > LIST_MAX) console.log(`  ... e mais ${(count ?? 0) - LIST_MAX}`);
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !FLAGS.includes(a));
  if (unknown.length) throw new Error(`Argumento desconhecido: ${unknown.join(" ")}. Use ${FLAGS.join(", ")} ou nada.`);
  if (args.length > 1) throw new Error(`Use um argumento só (${FLAGS.join(", ")}) ou nenhum.`);
  const [flag] = args;

  const token = process.env.PIPEDRIVE_API_TOKEN;
  // o token só é usado para falar com o Pipedrive: ligar, desligar e ver o status não precisam dele
  if (!flag && !token) throw new Error("PIPEDRIVE_API_TOKEN ausente.");
  const admin = createAdminClient();
  const client = createPipedriveClient({ token: token ?? "", baseUrl: process.env.PIPEDRIVE_BASE_URL || undefined });
  const store = supabasePushStore(admin, client);

  if (flag === "--status") return showStatus(admin, store);

  if (flag === "--ligar" || flag === "--desligar") {
    const enable = flag === "--ligar";
    const before = await store.settings();
    await store.setEnabled(enable, new Date());
    const after = await store.settings();
    if (enable) {
      console.log(before.enabled ? "A rotina já estava ligada: nada mudou." : "Rotina ligada.");
      console.log(`Cursor: ${when(after.cursor)}`);
      if (await store.mirrorActive(new Date())) {
        console.warn(
          "Atenção: a última importação do Pipedrive rodou como espelho há menos de 48 h. A rotina não envia nada até " +
            "uma sincronização sem espelho (pnpm sync:pipedrive, sem --espelho) terminar.",
        );
      }
    } else {
      console.log(before.enabled ? "Rotina desligada." : "A rotina já estava desligada.");
    }
    return;
  }

  const report = await runPipedrivePush({ client, store, now: () => new Date(), log: (m) => console.log(m) }, { budgetMs: BUDGET_MS });
  printReport(report);
  if (report.status === "failed") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
