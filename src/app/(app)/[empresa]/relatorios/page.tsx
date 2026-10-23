import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PresetCard } from "@/components/reports/preset-card";
import { Button } from "@/components/ui/button";
import { PRESETS } from "@/lib/reports/presets";
import { getReportPermissions } from "@/lib/reports/permissions";
import { listReports } from "@/lib/reports/queries";
import { BASES } from "@/lib/reports/spec";

export const instant = false;

const BASE_LABEL = Object.fromEntries(BASES.map((b) => [b.key, b.label]));

export default async function ReportsPage({ params }: { params: Promise<{ empresa: string }> }) {
  await connection();
  const { empresa } = await params;
  const perms = await getReportPermissions(empresa);
  if (!perms.viewReports) notFound();
  const reports = await listReports(empresa);

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold">Relatórios</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/${empresa}/relatorios/dashboards`}>Dashboards</Link>
          </Button>
          <Button asChild>
            <Link href={`/${empresa}/relatorios/novo`}>Novo relatório</Link>
          </Button>
        </div>
      </header>

      <section aria-labelledby="prontos" className="space-y-3">
        <h2 id="prontos" className="font-heading text-lg font-semibold">
          Relatórios prontos
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PRESETS.filter((p) => p.key !== "goal_progress").map((p) => (
            <PresetCard key={p.key} preset={p} href={`/${empresa}/relatorios/prontos/${p.key}`} />
          ))}
        </div>
      </section>

      <section aria-labelledby="salvos" className="space-y-3">
        <h2 id="salvos" className="font-heading text-lg font-semibold">
          Meus relatórios
        </h2>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">Você ainda não salvou nenhum relatório.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {reports.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/${empresa}/relatorios/${r.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-accent"
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {r.spec.kind === "custom" ? BASE_LABEL[r.spec.base] : "Relatório pronto"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
