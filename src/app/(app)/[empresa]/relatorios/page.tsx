import { LayoutDashboard } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getInsightPermissions, listInsights } from "@/lib/insights/queries";

export const instant = false;

/** Abre o primeiro painel (meus primeiro); sem painel, orienta a criar. */
export default async function InsightsHome({ params }: { params: Promise<{ empresa: string }> }) {
  await connection();
  const { empresa } = await params;
  const perms = await getInsightPermissions(empresa);
  const { dashboards } = await listInsights(perms.companyIds);
  const first = dashboards.find((d) => d.mine) ?? dashboards[0];
  if (first) redirect(`/${empresa}/relatorios/paineis/${first.id}`);
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <LayoutDashboard className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="font-heading text-xl font-semibold">Insights</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Crie relatórios com filtros, gráficos e cores, e junte os que quiser em painéis. Use o botão Criar ao lado.
      </p>
    </div>
  );
}
