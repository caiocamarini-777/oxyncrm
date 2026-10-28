import { notFound } from "next/navigation";
import { connection } from "next/server";
import { InsightsSidebar } from "@/components/insights/sidebar";
import { getAccessibleCompanies } from "@/lib/companies/scope";
import { getInsightPermissions, listInsights } from "@/lib/insights/queries";

/** Insights: lateral com painéis, metas e relatórios; o conteúdo ao lado. */
export default async function InsightsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ empresa: string }> }) {
  await connection();
  const { empresa } = await params;
  const perms = await getInsightPermissions(empresa);
  if (!perms.view) notFound();
  const [companies, data] = await Promise.all([getAccessibleCompanies(), listInsights(perms.companyIds)]);
  const scoped = companies.filter((c) => perms.companyIds.includes(c.id)).map((c) => ({ id: c.id, name: c.name }));
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <InsightsSidebar empresa={empresa} data={data} companies={scoped} canCreate={perms.create} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
