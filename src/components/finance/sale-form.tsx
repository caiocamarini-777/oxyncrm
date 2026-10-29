"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toInput } from "@/lib/finance/labels";
import { cancelSale, saveSale } from "@/lib/finance/sales-actions";
import { formatDate, formatMoney } from "@/lib/records/format";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export type SaleContractOption = { contractId: string; lineId: string; contractTitle: string; clientName: string | null };

/** Venda do próprio usuário, como a função fin_my_sales a devolve (sem percentuais nem comissão). */
export type MySale = {
  id: string;
  contractTitle: string;
  buyer: string;
  soldOn: string;
  setupValue: number;
  recurringValue: number;
  recurringMonths: number | null;
  status: string;
  editable: boolean;
  lineId: string;
  setupInstallments: number;
  setupFirstMonth: string | null;
  recurringStart: string | null;
  note: string | null;
};

const optionLabel = (o: SaleContractOption) => (o.clientName ? `${o.contractTitle} – ${o.clientName}` : o.contractTitle);
const money = (n: number) => (n > 0 ? toInput(n) : "");

function SaleDialog({
  companyId,
  contracts,
  sale,
  open,
  onOpenChange,
  today,
}: {
  companyId: string;
  contracts: SaleContractOption[];
  sale?: MySale;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  today: string;
}) {
  const router = useRouter();
  const [lineId, setLineId] = useState(sale?.lineId ?? "");
  const [buyer, setBuyer] = useState(sale?.buyer ?? "");
  const [soldOn, setSoldOn] = useState(sale?.soldOn ?? today);
  const [setupValue, setSetupValue] = useState(sale ? money(sale.setupValue) : "");
  const [installments, setInstallments] = useState(sale ? String(sale.setupInstallments) : "1");
  const [setupMonth, setSetupMonth] = useState(sale?.setupFirstMonth?.slice(0, 7) ?? today.slice(0, 7));
  const [recurringValue, setRecurringValue] = useState(sale ? money(sale.recurringValue) : "");
  const [recurringStart, setRecurringStart] = useState(sale?.recurringStart?.slice(0, 7) ?? "");
  const [recurringMonths, setRecurringMonths] = useState(sale?.recurringMonths ? String(sale.recurringMonths) : "");
  const [note, setNote] = useState(sale?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const err = (k: string) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null);

  // Na edição, a linha original pode já não estar entre as opções; mantém-na visível.
  const options = sale && !contracts.some((c) => c.lineId === sale.lineId)
    ? [...contracts, { contractId: "", lineId: sale.lineId, contractTitle: sale.contractTitle, clientName: null }]
    : contracts;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const r = await saveSale(companyId, sale?.id ?? null, {
      contractLineId: lineId,
      buyer,
      soldOn,
      setupValue,
      setupInstallments: installments,
      setupFirstMonth: setupMonth,
      recurringValue,
      recurringStart,
      recurringMonths,
      note,
    });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      setFormError(r.error);
      return;
    }
    toast.success(sale ? "Venda atualizada." : "Venda registrada.");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <DialogHeader>
            <DialogTitle>{sale ? "Editar venda" : "Nova venda"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="sale-contract">Contrato</Label>
              <select id="sale-contract" className={selectClass} value={lineId} onChange={(e) => setLineId(e.target.value)}>
                <option value="">Escolha…</option>
                {options.map((o) => (
                  <option key={o.lineId} value={o.lineId}>{optionLabel(o)}</option>
                ))}
              </select>
              {err("contractLineId")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sale-buyer">Cliente final</Label>
              <Input id="sale-buyer" value={buyer} maxLength={120} onChange={(e) => setBuyer(e.target.value)} />
              {err("buyer")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sale-date">Data da venda</Label>
              <Input id="sale-date" type="date" value={soldOn} onChange={(e) => setSoldOn(e.target.value)} />
              {err("soldOn")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sale-setup">Valor do setup</Label>
              <Input id="sale-setup" inputMode="decimal" placeholder="0,00" value={setupValue} onChange={(e) => setSetupValue(e.target.value)} />
              {err("setupValue")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="sale-installments">Parcelas do setup</Label>
                <Input id="sale-installments" inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value)} />
                {err("setupInstallments")}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="sale-setup-month">Primeiro recebimento do setup</Label>
                <Input id="sale-setup-month" type="month" value={setupMonth} onChange={(e) => setSetupMonth(e.target.value)} />
                {err("setupFirstMonth")}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="sale-recurring">Valor da recorrência (mensal)</Label>
              <Input id="sale-recurring" inputMode="decimal" placeholder="0,00" value={recurringValue} onChange={(e) => setRecurringValue(e.target.value)} />
              {err("recurringValue")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="sale-rec-start">Início da recorrência</Label>
                <Input id="sale-rec-start" type="month" value={recurringStart} onChange={(e) => setRecurringStart(e.target.value)} />
                {err("recurringStart")}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="sale-rec-months">Meses da recorrência</Label>
                <Input id="sale-rec-months" inputMode="numeric" value={recurringMonths} onChange={(e) => setRecurringMonths(e.target.value)} />
                {err("recurringMonths")}
              </div>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="sale-note">Observação (opcional)</Label>
              <Textarea id="sale-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              {err("note")}
            </div>
          </div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Tela do vendedor: botão "Nova venda" e a lista "Minhas vendas" com editar e cancelar. */
export function SalesManager({
  companyId,
  contracts,
  sales,
  today,
}: {
  companyId: string;
  contracts: SaleContractOption[];
  sales: MySale[];
  today: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MySale | null>(null);

  async function cancel(s: MySale) {
    if (!window.confirm(`Cancelar a venda para ${s.buyer}?`)) return;
    const r = await cancelSale(s.id);
    if (!r.ok) return toast.error(r.error);
    toast.success("Venda cancelada.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold">Vendas</h1>
        <Button type="button" size="sm" disabled={contracts.length === 0} onClick={() => setCreating(true)}>
          Nova venda
        </Button>
      </div>
      {contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum contrato disponível para registrar vendas.</p>
      ) : null}
      <section className="flex flex-col gap-2" aria-label="Minhas vendas">
        <h2 className="font-heading text-base font-semibold">Minhas vendas</h2>
        {sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">Você ainda não registrou nenhuma venda.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Contrato</th>
                  <th className="px-3 py-2">Cliente final</th>
                  <th className="px-3 py-2 text-right">Setup</th>
                  <th className="px-3 py-2 text-right">Recorrência</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-3 py-2">{formatDate(s.soldOn)}</td>
                    <td className="px-3 py-2">{s.contractTitle}</td>
                    <td className="px-3 py-2">{s.buyer}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.setupValue > 0 ? formatMoney(s.setupValue) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.recurringValue > 0 ? `${formatMoney(s.recurringValue)} × ${s.recurringMonths ?? 0}` : "—"}
                    </td>
                    <td className="px-3 py-2">{s.status === "cancelled" ? "Cancelada" : "Ativa"}</td>
                    <td className="px-3 py-2 text-right">
                      {s.editable && s.status === "active" ? (
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" aria-label={`Editar venda ${s.buyer}`} onClick={() => setEditing(s)}>
                            Editar
                          </Button>
                          <Button type="button" variant="ghost" size="sm" aria-label={`Cancelar venda ${s.buyer}`} onClick={() => cancel(s)}>
                            Cancelar
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {creating ? (
        <SaleDialog companyId={companyId} contracts={contracts} open onOpenChange={setCreating} today={today} />
      ) : null}
      {editing ? (
        <SaleDialog
          key={editing.id}
          companyId={companyId}
          contracts={contracts}
          sale={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          today={today}
        />
      ) : null}
    </div>
  );
}
