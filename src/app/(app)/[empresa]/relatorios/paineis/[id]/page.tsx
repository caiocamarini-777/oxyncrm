import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DashboardView } from "@/components/insights/dashboard/dashboard-view";
import { getCatalog, getColors, getDashboard, getInsightPermissions, listInsights } from "@/lib/insights/queries";

export const instant = false;

export default async function DashboardPage({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  await connection();
  const { empresa, id } = await params;
  const [perms, detail] = await Promise.all([getInsightPermissions(empresa), getDashboard(id)]);
  if (!detail || !perms.companyIds.includes(detail.dashboard.companyId)) notFound();
  const [catalog, colors, data] = await Promise.all([
    getCatalog(detail.dashboard.companyId),
    getColors(detail.dashboard.companyId),
    listInsights(perms.companyIds),
  ]);
  return (
    <DashboardView
      key={detail.dashboard.id}
      empresa={empresa}
      detail={detail}
      catalog={catalog}
      companyColors={colors.company}
      canShare={perms.share}
      canCreate={perms.create}
      available={data.reports}
    />
  );
}
