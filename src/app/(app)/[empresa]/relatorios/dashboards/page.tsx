import Link from "next/link";
import { connection } from "next/server";
import { NewDashboardDialog } from "@/components/dashboards/new-dashboard-dialog";
import { getReportPermissions } from "@/lib/reports/permissions";
import { listDashboards, type DashboardSummary } from "@/lib/reports/queries";

export const instant = false;

function DashboardList({ items, empresa, empty }: { items: DashboardSummary[]; empresa: string; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((d) => (
        <li key={d.id}>
          <Link
            href={`/${empresa}/relatorios/dashboards/${d.id}`}
            className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent"
          >
            <span className="font-medium">{d.name}</span>
            {d.ownerName ? <span className="text-sm text-muted-foreground">De {d.ownerName}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardsPage({ params }: { params: Promise<{ empresa: string }> }) {
  await connection();
  const { empresa } = await params;
  const perms = await getReportPermissions(empresa);
  const all = await listDashboards();
  const mine = all.filter((d) => !d.shared);
  const shared = all.filter((d) => d.shared);

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          {perms.viewReports ? (
            <Link href={`/${empresa}/relatorios`} className="text-sm text-muted-foreground hover:underline">
              Relatórios
            </Link>
          ) : null}
          <h1 className="font-heading text-2xl font-semibold">Dashboards</h1>
        </div>
        {perms.viewReports && perms.createDashboards ? <NewDashboardDialog empresa={empresa} /> : null}
      </header>

      {perms.viewReports ? (
      <section aria-labelledby="meus" className="space-y-3">
        <h2 id="meus" className="font-heading text-lg font-semibold">
          Meus dashboards
        </h2>
        <DashboardList items={mine} empresa={empresa} empty="Você ainda não criou nenhum dashboard." />
      </section>
      ) : null}

      <section aria-labelledby="compartilhados" className="space-y-3">
        <h2 id="compartilhados" className="font-heading text-lg font-semibold">
          Compartilhados comigo
        </h2>
        <DashboardList items={shared} empresa={empresa} empty="Nenhum dashboard foi compartilhado com você." />
      </section>
    </div>
  );
}
