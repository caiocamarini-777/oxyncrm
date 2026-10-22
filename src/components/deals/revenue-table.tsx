import { formatMoney } from "@/lib/records/format";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-03" para "mar/2026". */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? m}/${y}`;
}

export type ScheduleLine = { month: string; setup: number; mrr: number };

/** Receita mês a mês (Setup, MRR, Total) com linha de totais. */
export function RevenueTable({
  rows,
  testId = "revenue-table",
  empty = "Defina as condições do contrato para ver o cronograma.",
}: {
  rows: ScheduleLine[];
  testId?: string;
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <p data-testid={`${testId}-empty`} className="text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }
  const cents = (v: number) => Math.round(v * 100);
  const setup = rows.reduce((s, r) => s + cents(r.setup), 0) / 100;
  const mrr = rows.reduce((s, r) => s + cents(r.mrr), 0) / 100;
  return (
    <div className="max-h-96 overflow-auto">
      <table data-testid={testId} className="w-full text-xs">
        <thead className="sticky top-0 bg-card text-left text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pr-2 font-medium">
              Mês
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              Setup
            </th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">
              MRR
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} data-month={r.month} className="border-t">
              <th scope="row" className="py-1 pr-2 text-left font-normal">
                {formatMonth(r.month)}
              </th>
              <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(r.setup)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(r.mrr)}</td>
              <td className="py-1 text-right tabular-nums">{formatMoney((cents(r.setup) + cents(r.mrr)) / 100)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid={`${testId}-total`} className="border-t font-semibold">
            <th scope="row" className="py-1 pr-2 text-left">
              Total
            </th>
            <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(setup)}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{formatMoney(mrr)}</td>
            <td className="py-1 text-right tabular-nums">{formatMoney((cents(setup) + cents(mrr)) / 100)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
