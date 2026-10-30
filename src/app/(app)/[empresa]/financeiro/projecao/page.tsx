import { FinanceFilterBar } from "@/components/finance/finance-filters";
import { ProjectionChart } from "@/components/finance/projection-chart";
import { CumulativeChart } from "@/components/finance/cumulative-chart";
import { ResultChart } from "@/components/finance/result-chart";
import { ProjectionTable } from "@/components/finance/projection-table";
import { balanceSeries, monthlyProjection } from "@/lib/finance/calc";
import { monthLabelShort, monthRange } from "@/lib/finance/dates";
import { loadFinancePage } from "@/lib/finance/page-context";
import { listBalanceEntries, listEntries, listSnapshots } from "@/lib/finance/queries";
import { addMonths, cumulativeSeries, monthsBetween } from "@/lib/finance/views";

export const instant = false;

export default async function FinanceProjectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { company, today, filters, lookups } = await loadFinancePage(params, searchParams);

  // De janeiro do ano corrente até o mês corrente + `horizon` − 1.
  const currentMonth = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const months = monthsBetween(yearStart, addMonths(currentMonth, filters.horizon - 1));
  const from = yearStart;
  const to = monthRange(months[months.length - 1].slice(0, 7)).to;

  const [entries, snapshots] = await Promise.all([
    listEntries(company.id, { ...filters, from, to }, { basis: "competence" }),
    listSnapshots(company.id),
  ]);
  const rows = monthlyProjection(entries, months, today);

  let balances: (number | null)[] | null = null;
  if (snapshots.length > 0) {
    const earliest = snapshots.reduce((m, s) => (s.asOf < m ? s.asOf : m), snapshots[0].asOf);
    const balanceEntries = await listBalanceEntries(company.id, earliest < today ? earliest : today, to, {
      includePendingRenewals: filters.includePendingRenewals,
      includeEstimatedCommissions: filters.includeEstimatedCommissions,
    });
    // Meses anteriores ao primeiro saldo informado ficam sem valor ("—").
    const seriesFrom = earliest < yearStart ? yearStart : earliest;
    const series = balanceSeries(snapshots, balanceEntries, seriesFrom, to, today) ?? [];
    const byDate = new Map(series.map((p) => [p.date, p.balance]));
    balances = months.map((m) => {
      const end = monthRange(m.slice(0, 7)).to;
      return end < earliest ? null : (byDate.get(end) ?? null);
    });
  }

  const data = rows.map((r, i) => ({
    label: monthLabelShort(r.month),
    entradas: r.netIn,
    saidas: Math.round((r.fixed + r.variable + r.nonRecurring) * 100) / 100,
    saldo: balances ? balances[i] : null,
  }));

  const cumulative = cumulativeSeries(rows).map((r) => ({
    label: monthLabelShort(r.month),
    entradas: r.inAcc,
    saidas: r.outAcc,
    faixa: [Math.min(r.inAcc, r.outAcc), Math.max(r.inAcc, r.outAcc)] as [number, number],
  }));
  const resultData = rows.map((r) => ({ label: monthLabelShort(r.month), resultado: r.result }));

  return (
    <div className="flex flex-col gap-4">
      <FinanceFilterBar
        filters={filters}
        lookups={lookups}
        today={today}
        controls={["horizon", "clients", "services", "expenses", "natures", "renewals", "estimated"]}
      />
      <ProjectionChart data={data} />
      <CumulativeChart data={cumulative} />
      <ResultChart data={resultData} />
      <ProjectionTable rows={rows} balances={balances} />
    </div>
  );
}
