"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ContractFields, contractValuesFrom, type ContractValues } from "@/components/deals/contract-fields";
import { RevenueTable } from "@/components/deals/revenue-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateContract } from "@/lib/deals/actions";
import type { DealDetail } from "@/lib/deals/queries";
import { buildRevenueSchedule, contractValue } from "@/lib/deals/revenue";
import { formatMoney, parseBRL } from "@/lib/records/format";

const amount = (raw: string) => {
  const n = parseBRL(raw);
  return n === null || Number.isNaN(n) ? 0 : n;
};

/**
 * Condições do contrato com prévia do cronograma antes de salvar. Cada total vem dos produtos só
 * quando há itens daquele tipo (setup dos itens de implantação, MRR dos recorrentes).
 */
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
  const fromItems = useMemo(
    () => ({
      setup: deal.items.some((i) => i.kind === "setup"),
      mrr: deal.items.some((i) => i.kind === "recurring"),
    }),
    [deal.items],
  );
  const initial = useMemo(
    () =>
      contractValuesFrom({
        setupTotal: deal.setupTotal,
        setupInstallments: deal.setupInstallments,
        setupFirstDue: deal.setupFirstDue,
        mrr: deal.mrr,
        mrrStart: deal.mrrStart,
        contractMonths: deal.contractMonths,
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

  const setupTotal = fromItems.setup ? deal.setupTotal : amount(form.setupTotal);
  const mrr = fromItems.mrr ? deal.mrr : amount(form.mrr);
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

  const set = (k: keyof ContractValues, v: string) => setForm((f) => ({ ...f, [k]: v }));

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
            <ContractFields idPrefix="contract" values={form} onChange={set} errors={errors} fromItems={fromItems} />
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
