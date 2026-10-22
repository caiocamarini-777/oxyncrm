"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RevenueTable } from "@/components/deals/revenue-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateContract } from "@/lib/deals/actions";
import type { DealDetail } from "@/lib/deals/queries";
import { buildRevenueSchedule, contractValue } from "@/lib/deals/revenue";
import { formatMoney, parseBRL } from "@/lib/records/format";

const money = (v: number) => (v === 0 ? "" : String(v).replace(".", ","));
const amount = (raw: string) => {
  const n = parseBRL(raw);
  return n === null || Number.isNaN(n) ? 0 : n;
};

/** Condições do contrato com prévia do cronograma antes de salvar. Com produtos, setup e MRR vêm dos itens. */
export function ContractForm({
  deal,
  canEdit,
}: {
  deal: Pick<
    DealDetail,
    "id" | "items" | "setupTotal" | "setupInstallments" | "setupFirstDue" | "mrr" | "mrrStart" | "contractMonths"
  >;
  canEdit: boolean;
}) {
  const router = useRouter();
  const fromItems = deal.items.length > 0;
  const initial = useMemo(
    () => ({
      setupTotal: money(deal.setupTotal),
      setupInstallments: String(deal.setupInstallments || 1),
      setupFirstDue: deal.setupFirstDue ?? "",
      mrr: money(deal.mrr),
      mrrStart: deal.mrrStart ?? "",
      contractMonths: deal.contractMonths === null ? "" : String(deal.contractMonths),
    }),
    [deal.setupTotal, deal.setupInstallments, deal.setupFirstDue, deal.mrr, deal.mrrStart, deal.contractMonths],
  );
  const [form, setForm] = useState(initial);
  // Quando o servidor devolve outro contrato (itens, edição em outra aba), o formulário recomeça dele.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setForm(initial);
  }
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setupTotal = fromItems ? deal.setupTotal : amount(form.setupTotal);
  const mrr = fromItems ? deal.mrr : amount(form.mrr);
  const { total, preview } = useMemo(() => {
    const months = form.contractMonths === "" ? null : Number(form.contractMonths);
    const live = {
      setupTotal,
      setupInstallments: Number(form.setupInstallments) || 1,
      setupFirstDue: form.setupFirstDue || null,
      mrr,
      mrrStart: form.mrrStart || null,
      contractMonths: months !== null && Number.isFinite(months) ? months : null,
    };
    return { total: contractValue(live), preview: buildRevenueSchedule(live) };
  }, [setupTotal, mrr, form.setupInstallments, form.setupFirstDue, form.mrrStart, form.contractMonths]);
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);

  const set = (k: keyof typeof initial) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await updateContract(deal.id, form);
      if (res.ok) {
        toast.success("Contrato atualizado.");
        router.refresh();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Contrato</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <fieldset disabled={!canEdit || pending} className="flex min-w-0 flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field id="contract-setup" label="Setup total (R$)" error={errors.setupTotal} hint={fromItems ? "Calculado a partir dos produtos" : undefined}>
                <Input
                  id="contract-setup"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={fromItems ? money(deal.setupTotal) : form.setupTotal}
                  readOnly={fromItems}
                  onChange={set("setupTotal")}
                />
              </Field>
              <Field id="contract-installments" label="Parcelas" error={errors.setupInstallments}>
                <Input id="contract-installments" type="number" min={1} max={60} value={form.setupInstallments} onChange={set("setupInstallments")} />
              </Field>
              <Field id="contract-first-due" label="Mês da 1ª parcela" error={errors.setupFirstDue}>
                <Input id="contract-first-due" type="month" value={form.setupFirstDue} onChange={set("setupFirstDue")} />
              </Field>
              <span />
              <Field id="contract-mrr" label="MRR (R$)" error={errors.mrr} hint={fromItems ? "Calculado a partir dos produtos" : undefined}>
                <Input
                  id="contract-mrr"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={fromItems ? money(deal.mrr) : form.mrr}
                  readOnly={fromItems}
                  onChange={set("mrr")}
                />
              </Field>
              <Field id="contract-mrr-start" label="Início do MRR" error={errors.mrrStart}>
                <Input id="contract-mrr-start" type="month" value={form.mrrStart} onChange={set("mrrStart")} />
              </Field>
              <Field id="contract-months" label="Duração (meses)" error={errors.contractMonths}>
                <Input id="contract-months" type="number" min={1} max={120} value={form.contractMonths} onChange={set("contractMonths")} />
              </Field>
            </div>
          </fieldset>
          <p className="flex items-baseline justify-between border-t pt-2 text-sm">
            <span className="text-muted-foreground">Valor total do contrato</span>
            <strong data-testid="contract-total" className="tabular-nums">
              {formatMoney(total)}
            </strong>
          </p>
          {dirty ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Prévia do cronograma</p>
              <RevenueTable rows={preview} testId="schedule-preview" empty="Informe valores e datas para ver a prévia." />
            </div>
          ) : null}
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !dirty}>
                {pending ? "Salvando..." : "Salvar contrato"}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
