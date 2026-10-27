// Refaz o histórico de etapas dos negócios importados do Pipedrive a partir do fluxo de cada negócio
// (/v1/deals/{id}/flow). Sem isso, o histórico tem só a entrada na etapa atual e o "Ciclo de vendas" fica vazio.
// Uso: pnpm import:pipedrive-etapas
// Idempotente: apaga e recria o histórico de cada negócio importado. Etapas são casadas pelo nome dentro do funil
// do negócio; mudança para etapa sem correspondente é descartada (com aviso).
import postgres from "postgres";
import { stageHistory, type StageChange } from "@/lib/import/stage-history";
import { loadEnv, requireDbUrl } from "./load-env";

loadEnv();

const token = process.env.PIPEDRIVE_API_TOKEN;
if (!token) {
  console.error("PIPEDRIVE_API_TOKEN não configurado.");
  process.exit(1);
}
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pd(path: string): Promise<{ data: unknown; additional_data?: { pagination?: { more_items_in_collection?: boolean; next_start?: number } } }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`https://api.pipedrive.com${path}${sep}api_token=${token}`);
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`Pipedrive ${res.status} em ${path}`);
    return res.json();
  }
  throw new Error(`Pipedrive: limite de requisições em ${path}`);
}

async function flow(dealId: string): Promise<StageChange[]> {
  const out: StageChange[] = [];
  let start = 0;
  for (;;) {
    const body = await pd(`/v1/deals/${dealId}/flow?start=${start}&limit=100`);
    const items = (Array.isArray(body.data) ? body.data : []) as { object: string; data: Record<string, unknown> }[];
    for (const it of items) {
      if (it.object === "dealChange" && it.data.field_key === "stage_id" && it.data.old_value && it.data.new_value) {
        out.push({ from: String(it.data.old_value), to: String(it.data.new_value), at: String(it.data.log_time) });
      }
    }
    const pg = body.additional_data?.pagination;
    if (!pg?.more_items_in_collection || items.length === 0) return out;
    start = pg.next_start ?? start + items.length;
  }
}

async function main() {
  const sql = postgres(requireDbUrl(), { max: 1, onnotice: () => {} });
  try {
    const pdStages = (await pd("/v1/stages")).data as { id: number; name: string }[];
    const stageName = new Map(pdStages.map((s) => [String(s.id), s.name]));
    const deals = await sql<{ ext: string; id: string; company_id: string; pipeline_id: string }[]>`
      select e.external_id as ext, d.id, d.company_id, d.pipeline_id
      from external_ids e join deals d on d.id = e.record_id
      where e.source = 'pipedrive' and e.entity = 'deals' and d.deleted_at is null`;
    const ourStages = await sql<{ id: string; pipeline_id: string; name: string }[]>`select id, pipeline_id, name from stages`;
    let moves = 0;
    let skipped = 0;
    for (const d of deals) {
      const pdDeal = (await pd(`/v1/deals/${d.ext}`)).data as { add_time: string; stage_id: number };
      const changes = await flow(d.ext);
      const ours = (pdStage: string | null): string | null => {
        if (!pdStage) return null;
        const name = stageName.get(pdStage);
        return ourStages.find((s) => s.pipeline_id === d.pipeline_id && name && norm(s.name) === norm(name))?.id ?? null;
      };
      const rows = stageHistory(pdDeal.add_time, String(pdDeal.stage_id), changes)
        .map((m) => ({ ...m, fromId: ours(m.from), toId: ours(m.to) }))
        .filter((m) => {
          const ok = m.toId !== null && (m.from === null || m.fromId !== null);
          if (!ok) skipped++;
          return ok;
        });
      await sql.begin(async (tx) => {
        await tx`delete from deal_stage_history where deal_id = ${d.id}`;
        for (const m of rows) {
          await tx`insert into deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_by, moved_at, seconds_in_previous)
                   values (${d.id}, ${d.company_id}, ${m.fromId}, ${m.toId}, null, ${m.at}, ${m.secondsInPrevious})`;
        }
      });
      moves += rows.length;
    }
    console.log(`Histórico refeito: ${deals.length} negócios, ${moves} movimentos${skipped ? `, ${skipped} descartados (etapa sem correspondente)` : ""}.`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
