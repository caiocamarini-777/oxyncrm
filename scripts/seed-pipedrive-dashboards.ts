// Cria (ou recria) os painéis "KPIs - <EMPRESA>" e "<EMPRESA> - Resultados diretoria" em cada empresa, iguais aos
// do Pipedrive (catálogo em src/lib/reports/pipedrive-dashboards.ts).
// Uso: pnpm dashboards:pipedrive <email do dono> [slug da empresa ...]
// Idempotente: apaga e recria os painéis e relatórios do catálogo do mesmo dono (pelo nome).
// Os painéis ficam compartilhados com os membros ativos da empresa.
import postgres from "postgres";
import { buildCatalog, type Refs } from "@/lib/reports/pipedrive-dashboards";
import { reportSpecSchema } from "@/lib/reports/spec";
import { loadEnv, requireDbUrl } from "./load-env";

loadEnv();

const [ownerEmail, ...slugs] = process.argv.slice(2);
if (!ownerEmail) {
  console.error("Uso: pnpm dashboards:pipedrive <email do dono> [slug ...]");
  process.exit(1);
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function main() {
  const sql = postgres(requireDbUrl(), { max: 1, onnotice: () => {} });
  try {
    const [owner] = await sql<{ id: string }[]>`select id from profiles where lower(email) = lower(${ownerEmail}) and active`;
    if (!owner) throw new Error(`Usuário ativo não encontrado: ${ownerEmail}`);
    const companies = await sql<{ id: string; name: string; slug: string }[]>`
      select id, name, slug from companies
      where slug not like 'tst-%' and slug <> 'teste' ${slugs.length ? sql`and slug in ${sql(slugs)}` : sql``}
      order by name`;
    const users = await sql<{ id: string; email: string }[]>`select id, email from profiles where active`;
    const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

    for (const c of companies) {
      const [sources, outcomes, types, pipelines] = await Promise.all([
        sql<{ id: string; name: string }[]>`select id, name from lead_sources where company_id = ${c.id}`,
        sql<{ id: string; name: string }[]>`select id, name from activity_outcomes where company_id = ${c.id} and active`,
        sql<{ id: string }[]>`select id from activity_types where company_id = ${c.id} and is_meeting and active order by position limit 1`,
        sql<{ id: string }[]>`select id from pipelines where company_id = ${c.id} and archived_at is null order by position, name limit 1`,
      ]);
      const find = (rows: { id: string; name: string }[], name: string) =>
        rows.find((r) => norm(r.name) === norm(name))?.id ?? null;
      const refs: Refs = {
        source: (n) => find(sources, n),
        outcome: (n) => find(outcomes, n),
        meetingType: () => types[0]?.id ?? null,
        pipeline: () => pipelines[0]?.id ?? null,
        user: (e) => byEmail.get(e.toLowerCase()) ?? null,
      };
      const catalog = buildCatalog(c.name, refs);

      await sql.begin(async (tx) => {
        for (const dash of catalog) {
          // recria do zero: painel e relatórios do catálogo deste dono nesta empresa
          await tx`delete from dashboards where owner_id = ${owner.id} and name = ${dash.name}`;
          await tx`delete from reports where owner_id = ${owner.id} and company_id = ${c.id}
                   and name in ${tx(dash.widgets.map((w) => w.title))}`;
          const [d] = await tx<{ id: string }[]>`
            insert into dashboards (owner_id, name, default_filters)
            values (${owner.id}, ${dash.name}, ${tx.json(dash.defaultFilters)}) returning id`;
          let position = 0;
          for (const w of dash.widgets) {
            const spec = reportSpecSchema.parse(w.spec);
            const [rep] = await tx<{ id: string }[]>`
              insert into reports (company_id, owner_id, name, spec)
              values (${c.id}, ${owner.id}, ${w.title}, ${tx.json(spec as never)}) returning id`;
            await tx`insert into dashboard_widgets (dashboard_id, report_id, title, position, col_span, row_span)
                     values (${d!.id}, ${rep!.id}, ${w.title}, ${position++}, ${w.colSpan}, ${w.rowSpan})`;
          }
          await tx`insert into dashboard_shares (dashboard_id, user_id)
                   select ${d!.id}, m.user_id from memberships m join profiles p on p.id = m.user_id
                   where m.company_id = ${c.id} and p.active and m.user_id <> ${owner.id}
                   on conflict do nothing`;
          console.log(`${c.name}: ${dash.name} (${dash.widgets.length} widgets)`);
        }
      });
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
