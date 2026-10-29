import Link from "next/link";
import { ManagerSaleActions, type SaleContractOption } from "@/components/finance/sale-form";
import { Button } from "@/components/ui/button";
import type { SaleRow } from "@/lib/finance/queries";
import { formatDate, formatMoney } from "@/lib/records/format";

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

type Props = {
  sales: SaleRow[];
  empresa: string;
  contracts: { id: string; title: string }[];
  sellers: { id: string; name: string }[];
  /** Só para quem tem manage: habilita editar e cancelar (contratos = opções de fin_sales_contracts). */
  manage?: { companyId: string; contracts: SaleContractOption[]; today: string };
  filters: { contractId: string | null; sellerId: string | null; month: string | null };
};

/** Aba Vendas do Financeiro: filtros (GET) e a tabela de todas as vendas com comissão prevista e recebida. */
export function FinanceSalesTable({ sales, empresa, contracts, sellers, filters, manage }: Props) {
  const totalExpected = sales.reduce((a, s) => a + s.expected, 0);
  const totalReceived = sales.reduce((a, s) => a + s.received, 0);
  const filtered = !!(filters.contractId || filters.sellerId || filters.month);
  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filtros de vendas">
        <div className="flex flex-col gap-1">
          <label htmlFor="sales-contract" className="text-xs text-muted-foreground">Contrato</label>
          <select id="sales-contract" name="contrato" defaultValue={filters.contractId ?? ""} className={selectClass}>
            <option value="">Todos</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sales-seller" className="text-xs text-muted-foreground">Vendedor</label>
          <select id="sales-seller" name="vendedor" defaultValue={filters.sellerId ?? ""} className={selectClass}>
            <option value="">Todos</option>
            {sellers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sales-month" className="text-xs text-muted-foreground">Mês da venda</label>
          <input id="sales-month" name="mes" type="month" defaultValue={filters.month ?? ""} className={selectClass} />
        </div>
        <Button type="submit" size="sm" variant="outline">Filtrar</Button>
        {filtered ? (
          <Link href={`/${empresa}/financeiro/vendas`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
            Limpar filtros
          </Link>
        ) : null}
      </form>

      {sales.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma venda encontrada.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Contrato</th>
                <th className="px-3 py-2">Vendedor</th>
                <th className="px-3 py-2">Cliente final</th>
                <th className="px-3 py-2 text-right">Setup</th>
                <th className="px-3 py-2 text-right">Recorrência</th>
                <th className="px-3 py-2 text-right">Comissão prevista</th>
                <th className="px-3 py-2 text-right">Comissão recebida</th>
                {manage ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-2">{formatDate(s.soldOn)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/${empresa}/financeiro/contratos/${s.contractId}`} className="underline-offset-2 hover:underline">
                      {s.contractTitle}
                    </Link>
                    {s.clientName ? <span className="ml-1 text-xs text-muted-foreground">{s.clientName}</span> : null}
                  </td>
                  <td className="px-3 py-2">{s.sellerName ?? "—"}</td>
                  <td className="px-3 py-2">
                    {s.buyer}
                    {s.status === "cancelled" ? <span className="ml-2 text-xs text-muted-foreground">Cancelada</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.setupValue > 0 ? formatMoney(s.setupValue) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {s.recurringValue > 0 ? `${formatMoney(s.recurringValue)} × ${s.recurringMonths ?? 0}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.expected)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(s.received)}</td>
                  {manage ? (
                    <td className="px-3 py-2">
                      <ManagerSaleActions
                        companyId={manage.companyId}
                        contracts={manage.contracts}
                        today={manage.today}
                        sale={{
                          id: s.id,
                          contractTitle: s.contractTitle,
                          buyer: s.buyer,
                          soldOn: s.soldOn,
                          setupValue: s.setupValue,
                          recurringValue: s.recurringValue,
                          recurringMonths: s.recurringMonths,
                          status: s.status,
                          editable: true,
                          lineId: s.lineId,
                          setupInstallments: s.setupInstallments,
                          setupFirstMonth: s.setupFirstMonth,
                          recurringStart: s.recurringStart,
                          note: s.note,
                        }}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/30 font-medium">
              <tr>
                <td className="px-3 py-2" colSpan={6}>Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totalExpected)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(totalReceived)}</td>
                {manage ? <td /> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
