import { CostsChart } from "@/components/finance/costs-view";
import { FinanceFilterBar } from "@/components/finance/finance-filters";
import { balanceSeries, breakEven, coverageMonths, monthlyProjection } from "@/lib/finance/calc";
import { monthLabelShort } from "@/lib/finance/dates";
import { loadFinancePage } from "@/lib/finance/page-context";
import { listBalanceEntries, listEntries, listSnapshots } from "@/lib/finance/queries";
import { countableEntries, formatCoverage, formatShare, monthsBetween, shareOfDirection } from "@/lib/finance/views";
import { formatMoney } from "@/lib/records/format";

export const instant = false;

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default async function FinanceCostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, today, filters, lookups } = await loadFinancePage(params, searchParams);
  const months = monthsBetween(filters.from, filters.to);

  // A receita do ponto de equilíbrio não pode sofrer os filtros de despesa/natureza (eles descartam as entradas).
  const [all, revenueAll, snapshots] = await Promise.all([
    listEntries(company.id, filters, { basis: "competence" }),
    listEntries(company.id, { ...filters, expenseCategories: [], natures: [] }, { basis: "competence" }),
    listSnapshots(company.id),
  ]);
  const costs = countableEntries(all, today).filter((e) => e.direction === "out");
  const revenueRows = monthlyProjection(revenueAll, months, today);
  const rows = monthlyProjection(costs, months, today);

  const n = months.length;
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const fixedAvg = sum((r) => r.fixed) / n;
  const variableAvg = sum((r) => r.variable) / n;
  const revenueAvg = revenueRows.reduce((a, r) => a + r.netIn, 0) / n;
  const be = breakEven(fixedAvg, variableAvg, revenueAvg);

  let balance: number | null = null;
  if (snapshots.length > 0) {
    const earliest = snapshots.reduce((m, s) => (s.asOf < m ? s.asOf : m), snapshots[0].asOf);
    const balanceEntries = await listBalanceEntries(company.id, earliest < today ? earliest : today, today, {
      includePendingRenewals: filters.includePendingRenewals,
      includeEstimatedCommissions: filters.includeEstimatedCommissions,
    });
    balance = balanceSeries(snapshots, balanceEntries, today, today, today)?.[0]?.balance ?? null;
  }
  const coverage = balance === null ? null : coverageMonths(balance, fixedAvg);

  const names = new Map(lookups.expenseCategories.map((c) => [c.id, c.name]));
  const byCategory = shareOfDirection(costs, "out", "expenseCategoryId");

  return (
    <div className="flex flex-col gap-4">
      <FinanceFilterBar filters={filters} lookups={lookups} today={today} controls={["period", "expenses", "natures", "renewals", "estimated"]} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card label="Custo fixo médio mensal" value={formatMoney(Math.round(fixedAvg * 100) / 100)} />
        <Card
          label="Ponto de equilíbrio"
          value={be === null ? "—" : formatMoney(be)}
          hint={be === null ? "Sem receita no período, ou custos variáveis acima da receita." : "Receita mensal necessária para cobrir os custos."}
        />
        <Card
          label="Cobertura"
          value={formatCoverage(coverage)}
          hint={
            balance === null
              ? "Informe o saldo de uma conta em Configurações › Contas."
              : coverage === null
                ? "Sem custo fixo no período."
                : "Saldo atual dividido pelo custo fixo médio mensal."
          }
        />
      </div>
      <CostsChart data={rows.map((r) => ({ label: monthLabelShort(r.month), fixo: r.fixed, variavel: r.variable, naoRecorrente: r.nonRecurring }))} />
      {byCategory.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">Nenhum custo no período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Categoria</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Total no período</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.map((c) => (
                <tr key={c.key ?? "none"} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-normal">{(c.key && names.get(c.key)) || "Sem categoria"}</th>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(c.amount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatShare(c.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
