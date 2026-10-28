import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReportEditor } from "@/components/insights/editor/report-editor";
import { defaultDefinition, reportTypeInfo } from "@/lib/insights/definition";
import { getCatalog, getColors, getInsightPermissions, listInsights } from "@/lib/insights/queries";
import { DATA_TYPES, type DataType } from "@/lib/insights/types";

export const instant = false;

export default async function NewReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<{ entidade?: string; tipo?: string; empresa_id?: string }>;
}) {
  await connection();
  const [{ empresa }, sp] = await Promise.all([params, searchParams]);
  const perms = await getInsightPermissions(empresa);
  const dataType = (DATA_TYPES as readonly string[]).includes(sp.entidade ?? "") ? (sp.entidade as DataType) : "deals";
  const reportType = sp.tipo && reportTypeInfo(dataType, sp.tipo) ? sp.tipo : (dataType === "deals" ? "stats" : "performance");
  const companyId = sp.empresa_id && perms.companyIds.includes(sp.empresa_id) ? sp.empresa_id : perms.companyIds[0];
  if (!perms.create || !companyId) notFound();
  const [catalog, colors, data] = await Promise.all([getCatalog(companyId), getColors(companyId), listInsights(perms.companyIds)]);
  return (
    <ReportEditor
      key={`${dataType}:${reportType}:${companyId}`}
      empresa={empresa}
      companyId={companyId}
      report={null}
      initial={defaultDefinition(dataType, reportType)}
      catalog={catalog}
      companyColors={colors.company}
      savedColors={colors.saved}
      canEdit
      isOwner
      canShare={perms.share}
      canCreate={perms.create}
      dashboards={data.dashboards.filter((d) => d.mine && d.companyId === companyId)}
    />
  );
}
