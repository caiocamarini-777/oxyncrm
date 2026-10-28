// Recria no Oxyn os painéis do Insights do Pipedrive, nas 7 empresas: "KPIs - <EMPRESA>" no modelo
// "KPIS - OMNI11 novo" e "<EMPRESA> - Resultados diretoria". Lê os painéis e relatórios do Pipedrive pelo token.
// Uso: pnpm insights:pipedrive <email do dono> [slug ...]
// - Empresa com painel "novo" próprio no Pipedrive (OMNI11, HARPIX) usa o dela; as outras usam os blocos comuns
//   (LEADS e NEGÓCIOS) do "KPIS - OMNI11 novo". A diretoria vem da própria empresa ou, sem ela, da HARPIX.
// - Idempotente: apaga e recria, pelo nome, os painéis do dono e os relatórios que estavam neles.
// - Compartilha com os membros ativos da empresa e põe o filtro rápido de período de cada painel.
import postgres from "postgres";
import { translateReport, norm, type PdMeta, type PdReport, type Target } from "@/lib/insights/pipedrive/translate";
import type { Catalog } from "@/lib/insights/types";
import { loadEnv, requireDbUrl } from "./load-env";

loadEnv();

const [ownerEmail, ...slugs] = process.argv.slice(2);
if (!ownerEmail) {
  console.error("Uso: pnpm insights:pipedrive <email do dono> [slug ...]");
  process.exit(1);
}
const token = process.env.PIPEDRIVE_API_TOKEN;
if (!token) {
  console.error("PIPEDRIVE_API_TOKEN não configurado.");
  process.exit(1);
}

/** Nome da empresa no Pipedrive (rótulos, funis e painéis) por slug do Oxyn. */
const PD_COMPANY: Record<string, string> = {
  volt: "OMNI11",
  harpix: "HARPIX",
  naia: "NAIA",
  fqdtv: "FQDTV",
  oxyn: "OXYN",
  equilibrion: "EQUILIBRION",
  "fqd-studios": "FQD ESTÚDIOS",
};
const COMPANY_LABELS = new Set(["omni11", "harpix", "naia", "fqdtv", "oxyn", "equilibrion", "fqd estudios", "fqd studios"]);
const TEMPLATE_KPIS = "KPIS - OMNI11 novo";
const TEMPLATE_DIR = "HARPIX - Resultados diretoria";

type PdDashboard = { id: string; name: string; reports: { id: string; position: [number, number, number, number] }[]; quick_filters?: { period: string | null }[] };
type PdLabel = { field_id: string; id: string; name: string; parent_label_name?: string };
type PdFieldsEntity = { meta: { fields: { id: string; name: string }[]; labels?: PdLabel[] } };

async function pd<T>(path: string, init?: RequestInit): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://oxyngroup.pipedrive.com/api/v1/${path}${sep}api_token=${token}`, init);
  if (!res.ok) throw new Error(`Pipedrive ${res.status} em ${path}`);
  return ((await res.json()) as { data: T }).data;
}

function buildMeta(fields: Record<string, PdFieldsEntity> & { shared_meta: { meta: { labels: PdLabel[] } } }, emails: Map<string, string>): PdMeta {
  const shared = fields.shared_meta.meta.labels;
  const SHARED_FOR: Record<string, string> = { users: "users", stages: "stages", pipelines: "pipelines", lostReasons: "lostReasons" };
  const sharedName = (fid: string, v: string) => shared.find((l) => l.field_id === fid && l.id === v)?.name ?? null;
  const fieldShared = (id: string): string | null => {
    const rest = id.replace(/^(deal_id_|lead_id_|person_id_|org_id_|activity_id_)/, "");
    if (/(^|_)(userId|ownerId|creatorUserId|writerId)$/.test(rest) || ["userId", "ownerId", "creatorUserId", "writerId"].includes(rest)) return SHARED_FOR.users!;
    if (["stageId", "dealStageLogStageId"].includes(rest)) return "stages";
    if (rest === "pipelineId") return "pipelines";
    if (rest === "lostReason") return "lostReasons";
    if (rest === "channel") return "source_channel";
    if (rest === "type") return "activityTypes";
    return null;
  };
  return {
    fieldName: (entity, id) => fields[entity]?.meta.fields.find((f) => f.id === id)?.name ?? null,
    optionName: (entity, id, v) =>
      fields[entity]?.meta.labels?.find((l) => l.field_id === id && String(l.id) === String(v))?.name ??
      (fieldShared(id) ? sharedName(fieldShared(id)!, String(v)) : null),
    userEmail: (id) => emails.get(String(id)) ?? null,
    stage: (id) => {
      const l = shared.find((x) => x.field_id === "stages" && String(x.id) === String(id));
      return l ? { name: l.name, pipeline: l.parent_label_name ?? "" } : null;
    },
    pipelineName: (id) => sharedName("pipelines", String(id)),
  };
}

/** Tira o prefixo de empresa do nome do relatório do modelo ("Omni11 LEADS - Abertos") e põe o da empresa. */
function reportName(name: string, sourceCompany: string, display: string): string {
  const re = new RegExp(`^${sourceCompany.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
  return re.test(name) ? `${display} ${name.replace(re, "")}`.slice(0, 120) : name.slice(0, 120);
}

/** Bloco comum do modelo de KPIs (vale para qualquer empresa): LEADS, NEGÓCIOS e o total de oportunidades. */
function isCommonBlock(name: string): boolean {
  const n = name.replace(/^(omni11|harpix)\s+/i, "");
  return /^(LEADS|NEGÓCIOS) - /i.test(n) || /^TOTAL DE OPORTUNIDADES/i.test(n);
}

async function main() {
  const sql = postgres(requireDbUrl(), { max: 1, onnotice: () => {} });
  try {
    const [owner] = await sql<{ id: string }[]>`select id from profiles where lower(email) = lower(${ownerEmail}) and active`;
    if (!owner) throw new Error(`Usuário ativo não encontrado: ${ownerEmail}`);

    console.log("Lendo o Insights do Pipedrive...");
    const [dashboards, reports, fields, pdUsers] = await Promise.all([
      pd<PdDashboard[]>("insights-settings-api/dashboards"),
      pd<PdReport[]>("insights-settings-api/reports"),
      pd<Record<string, PdFieldsEntity> & { shared_meta: { meta: { labels: PdLabel[] } } }>("insights-api/fields"),
      pd<{ id: number; email: string }[]>("users"),
    ]);
    const meta = buildMeta(fields, new Map(pdUsers.map((u) => [String(u.id), u.email])));
    const repById = new Map(reports.map((r) => [r.id, r]));
    const dashByName = new Map(dashboards.map((d) => [norm(d.name), d]));

    const companies = await sql<{ id: string; name: string; slug: string }[]>`
      select id, name, slug from companies where slug in ${sql(slugs.length ? slugs : Object.keys(PD_COMPANY))} order by name`;

    for (const c of companies) {
      const pdName = PD_COMPANY[c.slug];
      if (!pdName) continue;
      const display = pdName === "FQD ESTÚDIOS" ? c.name : pdName;
      const [{ catalog }] = await sql<{ catalog: Catalog }[]>`select public.insights_catalog_for(${c.id}) as catalog`;
      const users = await sql<{ id: string; email: string; name: string }[]>`
        select p.id, p.email, coalesce(nullif(p.full_name, ''), p.email) as name from profiles p
        where exists (select 1 from memberships m where m.user_id = p.id and m.company_id = ${c.id}) or p.id = ${owner.id}`;
      const [main] = await sql<{ id: string }[]>`select id from pipelines where company_id = ${c.id} and archived_at is null order by position, name limit 1`;
      const target: Target = { catalog, users, companyLabels: COMPANY_LABELS, mainPipelineId: main?.id ?? null };

      const own = dashByName.get(norm(`KPIS - ${pdName} novo`));
      const kpiSource = own ?? dashByName.get(norm(TEMPLATE_KPIS))!;
      const dirSource = dashByName.get(norm(`${pdName} - Resultados diretoria`)) ?? dashByName.get(norm(TEMPLATE_DIR))!;
      const kpiCompany = own ? pdName : "OMNI11";
      const dirCompany = dirSource.name.split(" - ")[0]!;
      const plan = [
        { name: `KPIs - ${display}`, source: kpiSource, sourceCompany: kpiCompany, filter: own ? null : isCommonBlock, period: "month" },
        {
          name: `${display} - Resultados diretoria`,
          source: dirSource,
          sourceCompany: dirCompany,
          filter: null,
          period: dirSource.quick_filters?.map((q) => (q.period ? (JSON.parse(q.period) as { period: string }).period : null)).find(Boolean) ?? "lastWeek",
        },
      ];

      const members = await sql<{ user_id: string }[]>`
        select m.user_id from memberships m join profiles p on p.id = m.user_id
        where m.company_id = ${c.id} and p.active and m.user_id <> ${owner.id}`;
      const notes = new Map<string, number>();
      let created = 0;

      await sql.begin(async (tx) => {
        for (const p of plan) {
          // idempotência: apaga o painel de mesmo nome do dono e os relatórios do dono que estavam nele
          const old = await tx<{ id: string }[]>`select id from insight_dashboards where owner_id = ${owner.id} and company_id = ${c.id} and name = ${p.name}`;
          for (const o of old) {
            await tx`delete from insight_reports r where r.owner_id = ${owner.id} and r.id in (select report_id from insight_dashboard_reports where dashboard_id = ${o.id})`;
            await tx`delete from insight_dashboards where id = ${o.id}`;
          }
          const [dash] = await tx<{ id: string }[]>`insert into insight_dashboards (company_id, owner_id, name) values (${c.id}, ${owner.id}, ${p.name}) returning id`;
          const items = p.source.reports
            .map((it) => ({ it, rep: repById.get(it.id) }))
            .filter((x): x is { it: (typeof p.source.reports)[number]; rep: PdReport } => !!x.rep && (!p.filter || p.filter(x.rep.name)));
          const minY = Math.min(...items.map((x) => x.it.position[1]));
          for (const { it, rep } of items) {
            const { def, notes: n } = translateReport(rep, meta, target);
            for (const x of n) notes.set(x, (notes.get(x) ?? 0) + 1);
            if (!def) {
              console.warn(`  [${c.slug}] ${rep.name}: não traduzido (${n.join("; ")})`);
              continue;
            }
            const [r] = await tx<{ id: string }[]>`
              insert into insight_reports (company_id, owner_id, name, data_type, report_type, chart_type, parameters, columns, colors)
              values (${c.id}, ${owner.id}, ${reportName(rep.name, p.sourceCompany, display)}, ${def.data_type}, ${def.report_type},
                ${def.chart_type}, ${tx.json(def.parameters as never)}, ${tx.json(def.columns as never)}, ${tx.json({})}) returning id`;
            const [x, y, w, h] = it.position;
            await tx`insert into insight_dashboard_reports (dashboard_id, report_id, x, y, w, h)
                     values (${dash!.id}, ${r!.id}, ${Math.min(Math.max(x, 0), 3)}, ${y - minY}, ${Math.min(Math.max(w, 1), 4 - Math.min(Math.max(x, 0), 3))}, ${Math.min(Math.max(h, 2), 20)})`;
            created++;
          }
          for (const m of members) {
            await tx`insert into insight_dashboard_shares (dashboard_id, user_id) values (${dash!.id}, ${m.user_id}) on conflict do nothing`;
          }
          for (const u of [owner.id, ...members.map((m) => m.user_id)]) {
            await tx`insert into insight_quick_filters (dashboard_id, user_id, period) values (${dash!.id}, ${u}, ${tx.json({ period: p.period })})
                     on conflict (dashboard_id, user_id) do update set period = excluded.period`;
          }
        }
      });
      console.log(`${c.name}: ${plan.map((p) => p.name).join(" e ")} (${created} relatórios, ${members.length} membros)`);
      for (const [n, k] of notes) console.log(`  · ${n}${k > 1 ? ` (${k}x)` : ""}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
