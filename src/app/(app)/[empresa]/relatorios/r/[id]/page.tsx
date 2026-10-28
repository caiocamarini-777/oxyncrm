import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReportEditor } from "@/components/insights/editor/report-editor";
import { requireUser } from "@/lib/auth/session";
import { getCatalog, getColors, getInsightPermissions, getReport, listInsights } from "@/lib/insights/queries";

export const instant = false;

export default async function ReportPage({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  await connection();
  const { empresa, id } = await params;
  const [perms, found, profile] = await Promise.all([getInsightPermissions(empresa), getReport(id), requireUser()]);
  if (!found || !perms.companyIds.includes(found.report.companyId)) notFound();
  const { report, access } = found;
  const [catalog, colors, data] = await Promise.all([getCatalog(report.companyId), getColors(report.companyId), listInsights(perms.companyIds)]);
  return (
    <ReportEditor
      key={`${report.id}:${report.updatedAt}`}
      empresa={empresa}
      companyId={report.companyId}
      report={{ id: report.id, name: report.name }}
      initial={report.definition}
      catalog={catalog}
      companyColors={colors.company}
      savedColors={colors.saved}
      canEdit={access === "edit"}
      isOwner={report.ownerId === profile.id || profile.isSuperAdmin}
      canShare={perms.share}
      canCreate={perms.create}
      dashboards={data.dashboards.filter((d) => d.mine && d.companyId === report.companyId)}
    />
  );
}
