import { notFound } from "next/navigation";
import { BalanceMissing } from "@/components/finance/balance-missing";
import { FinanceFilterBar } from "@/components/finance/finance-filters";
import { MonthView, type MonthDay } from "@/components/finance/month-view";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { balanceSeries, type EntryRow } from "@/lib/finance/calc";
import { monthLabel, monthRange, todaySaoPaulo } from "@/lib/finance/dates";
import { parseFinanceFilters, toFinanceSearchParams } from "@/lib/finance/filters";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { listBalanceEntries, listFinanceLookups, listSnapshots } from "@/lib/finance/queries";

export const instant = false;

/** Data em que o lançamento mexe no caixa (liquidado: quando saiu; em aberto: o vencimento, ou hoje se vencido). */
function cashDay(e: EntryRow, today: string): string | null {
  if (e.status === "cancelled") return null;
  if (e.status === "settled") return e.settledOn;
  return e.dueDate > today ? e.dueDate : today;
}

export default async function FinanceMonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ empresa }, sp, profile, companies] = await Promise.all([params, searchParams, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const company = scope.company;

  const today = todaySaoPaulo();
  // Esta tela mostra sempre um mês inteiro: o mês de `from`.
  const parsed = parseFinanceFilters(sp, today);
  const ym = parsed.from.slice(0, 7);
  const { from, to } = monthRange(ym);
  const filters = { ...parsed, from, to };
  const nav = (delta: number) => {
    const r = monthRange(ym, delta);
    const qs = toFinanceSearchParams({ ...filters, from: r.from, to: r.to }, today).toString();
    return `/${company.slug}/financeiro${qs ? `?${qs}` : ""}`;
  };

  const [access, snapshots, lookups] = await Promise.all([
    getFinanceAccess(company.id),
    listSnapshots(company.id),
    listFinanceLookups(company.id),
  ]);

  const bar = (
    <FinanceFilterBar
      filters={filters}
      lookups={lookups}
      today={today}
      controls={["renewals", "estimated"]}
    />
  );

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {bar}
        <BalanceMissing empresa={company.slug} canManage={access.manage} />
      </div>
    );
  }

  const seriesFrom = from < today ? from : today;
  const seriesTo = to > today ? to : today;
  const earliest = snapshots.reduce((m, s) => (s.asOf < m ? s.asOf : m), snapshots[0].asOf);
  const since = earliest < seriesFrom ? earliest : seriesFrom;
  const entries = await listBalanceEntries(company.id, since, seriesTo, {
    includePendingRenewals: filters.includePendingRenewals,
    includeEstimatedCommissions: filters.includeEstimatedCommissions,
  });
  const series = balanceSeries(snapshots, entries, seriesFrom, seriesTo, today) ?? [];
  const balanceOn = (d: string) => series.find((p) => p.date === d)?.balance ?? 0;

  const byDay = new Map<string, EntryRow[]>();
  let receivable = 0;
  let payable = 0;
  for (const e of entries) {
    const day = cashDay(e, today);
    if (!day || day < from || day > to) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
    if (e.status === "open") {
      if (e.direction === "in") receivable += e.amount;
      else payable += e.amount;
    }
  }
  const days: MonthDay[] = [...byDay.keys()].sort().map((date) => ({ date, balance: balanceOn(date), entries: byDay.get(date)! }));

  return (
    <div className="flex flex-col gap-4">
      {bar}
      <MonthView
        label={monthLabel(from)}
        prevHref={nav(-1)}
        nextHref={nav(1)}
        cards={{
          current: balanceOn(today),
          receivable: Math.round(receivable * 100) / 100,
          payable: Math.round(payable * 100) / 100,
          projected: balanceOn(to),
        }}
        days={days}
        lookups={lookups}
        companyId={company.id}
        today={today}
        canManage={access.manage}
      />
    </div>
  );
}
