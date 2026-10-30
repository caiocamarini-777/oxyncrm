import { FinanceFilterBar } from "@/components/finance/finance-filters";
import { ShareChart } from "@/components/finance/share-chart";
import { loadFinancePage } from "@/lib/finance/page-context";
import { END_RULE_LABEL } from "@/lib/finance/labels";
import { listActiveContractLines, listEntries } from "@/lib/finance/queries";
import { clientContractInfo, endsWithin, formatShare, shareOfDirection, countableEntries } from "@/lib/finance/views";
import { formatDate, formatMoney } from "@/lib/records/format";

export const instant = false;

export default async function FinanceClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, today, filters, lookups } = await loadFinancePage(params, searchParams);
  const [all, lines] = await Promise.all([
    listEntries(company.id, filters, { basis: "competence" }),
    listActiveContractLines(company.id),
  ]);
  const entries = countableEntries(all, today);
  const shares = shareOfDirection(entries, "in", "organizationId");
  const info = clientContractInfo(lines, today);
  const names = new Map(lookups.clients.map((c) => [c.id, c.name]));
  const rows = shares.map((s) => ({
    ...s,
    name: (s.key && names.get(s.key)) || "Sem cliente",
    info: s.key ? info.get(s.key) : undefined,
  }));

  return (
    <div className="flex flex-col gap-4">
      <FinanceFilterBar filters={filters} lookups={lookups} today={today} controls={["period", "clients", "services", "renewals", "estimated"]} />
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Nenhuma receita de clientes no período.</p>
      ) : (
        <>
          <ShareChart data={rows.map((r) => ({ label: r.name, amount: r.amount, share: r.share, color: "var(--chart-1)" }))} />
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">Cliente</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Receita no período</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">MRR atual</th>
                  <th scope="col" className="px-3 py-2 font-medium">Fim da vigência</th>
                  <th scope="col" className="px-3 py-2 font-medium">Regra</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key ?? "none"} className="border-b last:border-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">{r.name}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatShare(r.share)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.info ? formatMoney(r.info.mrr) : "—"}</td>
                    <td className="px-3 py-2">
                      {r.info?.endsOn ? (
                        <span className="flex flex-wrap items-center gap-2">
                          {formatDate(r.info.endsOn)}
                          {endsWithin(r.info.endsOn, today) ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                              vence em até 90 dias
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">{r.info?.endRule ? END_RULE_LABEL[r.info.endRule] : "—"}</td>
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
