// Recria no Oxyn, exatamente como no Insights do Pipedrive, os painéis (mesmo nome, relatórios e posições) e os
// relatórios avulsos, cada um na empresa a que se refere. Lê tudo pelo token do Pipedrive.
// Uso: pnpm insights:pipedrive <email do dono> [slug ...]
// - Empresa do painel: a que a maioria dos relatórios dele filtra (etiqueta, "Empresa Proprietária", funil, nome).
// - Relatório avulso: vai para cada empresa a que se refere; sem empresa, vai para a Oxyn.
// - Idempotente: apaga e recria, pelo nome, os painéis e relatórios que o script criou para o dono (inclusive os
//   do modelo "novo" das versões anteriores).
// - Compartilha com os membros ativos da empresa e usa o filtro rápido de período salvo no Pipedrive.
import postgres from "postgres";
import { norm, pdCompanies, translateReport, type PdMeta, type PdReport, type Target } from "@/lib/insights/pipedrive/translate";
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

/** Nome da empresa no Pipedrive (rótulos, funis, "Empresa Proprietária") -> slug do Oxyn. */
const SLUG_OF: Record<string, string> = {
  omni11: "volt",
  harpix: "harpix",
  naia: "naia",
  fqdtv: "fqdtv",
  oxyn: "oxyn",
  equilibrion: "equilibrion",
  "fqd estudios": "fqd-studios",
  "fqd studios": "fqd-studios",
};
const COMPANY_LABELS = new Set(Object.keys(SLUG_OF));
/** Nomes que versões anteriores do script criaram (modelo "novo" em todas as empresas). */
const OLD_NAMES = (display: string) => [`KPIs - ${display}`, `${display} - Resultados diretoria`];

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
      select id, name, slug from companies where slug in ${sql(slugs.length ? slugs : [...new Set(Object.values(SLUG_OF))])} order by name`;
    const slugsOf = (r: PdReport) => [...new Set(pdCompanies(r, meta, COMPANY_LABELS).map((n) => SLUG_OF[n]!))];

    // o que vai para cada empresa: painéis (pela maioria dos relatórios) e relatórios avulsos
    type Plan = { dashboards: { pd: PdDashboard; period: string | null }[]; loose: PdReport[] };
    const plan = new Map<string, Plan>(companies.map((c) => [c.slug, { dashboards: [], loose: [] }]));
    const onDashboard = new Set(dashboards.flatMap((d) => d.reports.map((r) => r.id)));
    for (const d of dashboards) {
      const votes = new Map<string, number>();
      for (const it of d.reports) for (const sl of slugsOf(repById.get(it.id) ?? ({ name: "", parameters: {} } as PdReport))) votes.set(sl, (votes.get(sl) ?? 0) + 1);
      const fromName = slugsOf({ name: d.name, parameters: {} } as PdReport)[0];
      const slug = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? fromName ?? "oxyn";
      const period = d.quick_filters?.map((q) => (q.period ? (JSON.parse(q.period) as { period: string }).period : null)).find(Boolean) ?? null;
      plan.get(slug)?.dashboards.push({ pd: d, period });
    }
    for (const r of reports) {
      if (onDashboard.has(r.id)) continue;
      const targets = slugsOf(r);
      for (const sl of targets.length ? targets : ["oxyn"]) plan.get(sl)?.loose.push(r);
    }
    const looseNames = [...new Set(reports.filter((r) => !onDashboard.has(r.id)).map((r) => r.name.slice(0, 120)))];

    for (const c of companies) {
      const p = plan.get(c.slug)!;
      const display = c.slug === "volt" ? "OMNI11" : c.slug === "oxyn" ? "OXYN" : c.name;
      const [{ catalog }] = await sql<{ catalog: Catalog }[]>`select public.insights_catalog_for(${c.id}) as catalog`;
      const users = await sql<{ id: string; email: string; name: string }[]>`
        select p.id, p.email, coalesce(nullif(p.full_name, ''), p.email) as name from profiles p
        where exists (select 1 from memberships m where m.user_id = p.id and m.company_id = ${c.id}) or p.id = ${owner.id}`;
      const [main] = await sql<{ id: string }[]>`select id from pipelines where company_id = ${c.id} and archived_at is null order by position, name limit 1`;
      const target: Target = { catalog, users, companyLabels: COMPANY_LABELS, mainPipelineId: main?.id ?? null };
      const members = await sql<{ user_id: string }[]>`
        select m.user_id from memberships m join profiles p on p.id = m.user_id
        where m.company_id = ${c.id} and p.active and m.user_id <> ${owner.id}`;
      const notes = new Map<string, number>();
      let created = 0;

      const insertReport = async (tx: postgres.TransactionSql, rep: PdReport): Promise<string | null> => {
        const { def, notes: n } = translateReport(rep, meta, target);
        for (const x of n) notes.set(x, (notes.get(x) ?? 0) + 1);
        if (!def) {
          console.warn(`  [${c.slug}] ${rep.name}: não traduzido (${n.join("; ")})`);
          return null;
        }
        const [r] = await tx<{ id: string }[]>`
          insert into insight_reports (company_id, owner_id, name, data_type, report_type, chart_type, parameters, columns, colors)
          values (${c.id}, ${owner.id}, ${rep.name.trim().slice(0, 120) || "Relatório"}, ${def.data_type}, ${def.report_type},
            ${def.chart_type}, ${tx.json(def.parameters as never)}, ${tx.json(def.columns as never)}, ${tx.json({})}) returning id`;
        created++;
        return r!.id;
      };

      await sql.begin(async (tx) => {
        // idempotência: painéis com os nomes do Pipedrive e os do modelo antigo, e os avulsos de mesmo nome
        const names = [...new Set([...OLD_NAMES(display), ...dashboards.map((d) => d.name)])];
        const old = await tx<{ id: string }[]>`select id from insight_dashboards where owner_id = ${owner.id} and company_id = ${c.id} and name in ${tx(names)}`;
        for (const o of old) {
          await tx`delete from insight_reports r where r.owner_id = ${owner.id} and r.id in (select report_id from insight_dashboard_reports where dashboard_id = ${o.id})`;
          await tx`delete from insight_dashboards where id = ${o.id}`;
        }
        if (looseNames.length) {
          await tx`delete from insight_reports r where r.owner_id = ${owner.id} and r.company_id = ${c.id} and r.name in ${tx(looseNames)}
                   and not exists (select 1 from insight_dashboard_reports i where i.report_id = r.id)`;
        }

        for (const { pd: d, period } of p.dashboards) {
          const [dash] = await tx<{ id: string }[]>`insert into insight_dashboards (company_id, owner_id, name) values (${c.id}, ${owner.id}, ${d.name.trim()}) returning id`;
          const items = d.reports.map((it) => ({ it, rep: repById.get(it.id) })).filter((x) => !!x.rep);
          const minY = Math.min(...items.map((x) => x.it.position[1]));
          for (const { it, rep } of items) {
            const id = await insertReport(tx, rep!);
            if (!id) continue;
            const [x, y, w, h] = it.position;
            const cx = Math.min(Math.max(x, 0), 3);
            await tx`insert into insight_dashboard_reports (dashboard_id, report_id, x, y, w, h)
                     values (${dash!.id}, ${id}, ${cx}, ${y - minY}, ${Math.min(Math.max(w, 1), 4 - cx)}, ${Math.min(Math.max(h, 2), 20)})`;
          }
          for (const m of members) {
            await tx`insert into insight_dashboard_shares (dashboard_id, user_id) values (${dash!.id}, ${m.user_id}) on conflict do nothing`;
          }
          if (period) {
            for (const u of [owner.id, ...members.map((m) => m.user_id)]) {
              await tx`insert into insight_quick_filters (dashboard_id, user_id, period) values (${dash!.id}, ${u}, ${tx.json({ period })})
                       on conflict (dashboard_id, user_id) do update set period = excluded.period`;
            }
          }
        }
        for (const rep of p.loose) {
          const id = await insertReport(tx, rep);
          if (!id) continue;
          for (const m of members) {
            await tx`insert into insight_report_shares (report_id, user_id) values (${id}, ${m.user_id}) on conflict do nothing`;
          }
        }
      });
      console.log(
        `${c.name}: ${p.dashboards.length ? p.dashboards.map((d) => d.pd.name).join(", ") : "sem painel"}; ${p.loose.length} avulsos (${created} relatórios, ${members.length} membros)`,
      );
      for (const [n, k] of notes) if (!n.startsWith("etiqueta da empresa")) console.log(`  · ${n}${k > 1 ? ` (${k}x)` : ""}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
