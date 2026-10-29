import { FinanceFilterBar } from "@/components/finance/finance-filters";
import { ShareChart } from "@/components/finance/share-chart";
import { loadFinancePage } from "@/lib/finance/page-context";
import { listEntries } from "@/lib/finance/queries";
import { countableEntries, formatShare, shareOfDirection } from "@/lib/finance/views";
import { formatMoney } from "@/lib/records/format";

export const instant = false;

const NO_CATEGORY_COLOR = "#9CA3AF";

export default async function FinanceServicesPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, today, filters, lookups } = await loadFinancePage(params, searchParams);
  const all = await listEntries(company.id, filters, { basis: "competence" });
  const shares = shareOfDirection(countableEntries(all, today), "in", "serviceCategoryId");
  const cats = new Map(lookups.serviceCategories.map((c) => [c.id, c]));
  const rows = shares.map((s) => {
    const c = s.key ? cats.get(s.key) : undefined;
    return { ...s, name: c?.name ?? "Sem categoria", color: c?.color ?? NO_CATEGORY_COLOR };
  });

  return (
    <div className="flex flex-col gap-4">
      <FinanceFilterBar filters={filters} lookups={lookups} today={today} controls={["period", "clients", "services", "renewals", "estimated"]} />
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Nenhuma receita de serviços no período.</p>
      ) : (
        <>
          <ShareChart data={rows.map((r) => ({ label: r.name, amount: r.amount, share: r.share, color: r.color }))} />
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Serviço</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Receita no período</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key ?? "none"} className="border-b last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="inline-flex items-center gap-2">
                        <span className="size-2.5 rounded-sm" style={{ background: r.color }} aria-hidden />
                        {r.name}
                      </span>
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatShare(r.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
