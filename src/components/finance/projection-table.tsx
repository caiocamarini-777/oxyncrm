import type { MonthRow } from "@/lib/finance/calc";
import { monthLabelShort } from "@/lib/finance/dates";
import { formatMoney } from "@/lib/records/format";
import { cn } from "cn";

/** Tabela da projeção: uma coluna por mês. `balances` é nulo quando não há saldo informado. */
export function ProjectionTable({ rows, balances }: { rows: MonthRow[]; balances: (number | null)[] | null }) {
  const lines: { label: string; values: (number | null)[]; strong?: boolean; sign?: boolean; hint?: string }[] = [
    { label: "Receita bruta", values: rows.map((r) => r.grossIn) },
    { label: "Retenções", values: rows.map((r) => -r.retention) },
    { label: "Receita líquida", values: rows.map((r) => r.netIn), strong: true },
    { label: "Custos fixos", values: rows.map((r) => -r.fixed) },
    { label: "Custos variáveis", values: rows.map((r) => -r.variable) },
    { label: "Não recorrentes", values: rows.map((r) => -r.nonRecurring) },
    { label: "Resultado", values: rows.map((r) => r.result), strong: true, sign: true },
    {
      label: "Saldo no fim do mês",
      values: balances ?? rows.map(() => null),
      strong: true,
      sign: true,
      hint: balances ? undefined : "Informe o saldo de uma conta em Configurações",
    },
  ];
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-max text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="sticky left-0 bg-background px-3 py-2 font-medium">Mês</th>
            {rows.map((r) => (
              <th key={r.month} scope="col" data-testid="proj-month" className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {monthLabelShort(r.month)}
                {r.realized ? <span className="block text-[10px] font-normal">realizado</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.label} className="border-b last:border-0">
              <th scope="row" title={l.hint} className={cn("sticky left-0 bg-background px-3 py-2 text-left font-normal", l.strong && "font-semibold")}>
                {l.label}
              </th>
              {l.values.map((v, i) => (
                <td
                  key={rows[i].month}
                  title={v === null ? l.hint : undefined}
                  className={cn("whitespace-nowrap px-3 py-2 text-right tabular-nums", l.strong && "font-semibold", l.sign && v !== null && v < 0 && "text-destructive")}
                >
                  {v === null ? "—" : formatMoney(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {balances ? null : <p className="px-3 py-2 text-xs text-muted-foreground">Informe o saldo de uma conta em Configurações › Contas para ver o saldo projetado.</p>}
    </div>
  );
}
