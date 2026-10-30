"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EntryRow } from "@/lib/finance/calc";
import { createManualEntry, updateEntry } from "@/lib/finance/entries-actions";
import { createRecurringItem } from "@/lib/finance/expenses-actions";
import type { FinanceLookups } from "@/lib/finance/queries";

const selectClass = "h-8 w-full rounded-lg border bg-background px-2 text-sm";
const NATURES = [
  { id: "fixed", name: "Fixa" },
  { id: "variable", name: "Variável" },
  { id: "non_recurring", name: "Não recorrente" },
];

export type EntryDialogLookups = Pick<
  FinanceLookups,
  "accounts" | "serviceCategories" | "expenseCategories" | "incomeCategories" | "clients"
>;

/** Lançamento avulso: novo (sem `entry`) ou edição de um em aberto. */
export function EntryDialog({
  companyId,
  lookups,
  today,
  entry,
  open,
  onOpenChange,
}: {
  companyId: string;
  lookups: EntryDialogLookups;
  today: string;
  entry?: EntryRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const editing = !!entry;
  const [direction, setDirection] = useState<"in" | "out">(entry?.direction ?? "out");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [gross, setGross] = useState(entry ? entry.gross.toFixed(2).replace(".", ",") : "");
  const [dueDate, setDueDate] = useState(entry?.dueDate ?? today);
  const [periodicity, setPeriodicity] = useState<"once" | "monthly" | "quarterly" | "yearly">("once");
  const [endDate, setEndDate] = useState("");
  const [accountId, setAccountId] = useState(entry?.accountId ?? "");
  const [organizationId, setOrganizationId] = useState(entry?.organizationId ?? "");
  // Receita: "s:<serviço>" ou "i:<categoria de receita>"; despesa: id da categoria.
  const [incomeCat, setIncomeCat] = useState(
    entry?.serviceCategoryId ? `s:${entry.serviceCategoryId}` : entry?.incomeCategoryId ? `i:${entry.incomeCategoryId}` : "",
  );
  const [expenseCat, setExpenseCat] = useState(entry?.expenseCategoryId ?? "");
  const [nature, setNature] = useState<string>(entry?.nature ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function pickExpenseCategory(id: string) {
    setExpenseCat(id);
    const cat = lookups.expenseCategories.find((c) => c.id === id);
    if (cat && !nature) setNature(cat.defaultNature);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const recurring = !editing && periodicity !== "once";
    const common = {
      direction,
      description,
      accountId: accountId || null,
      organizationId: organizationId || null,
      incomeCategoryId: direction === "in" && incomeCat.startsWith("i:") ? incomeCat.slice(2) : null,
      serviceCategoryId: direction === "in" && incomeCat.startsWith("s:") ? incomeCat.slice(2) : null,
      expenseCategoryId: direction === "out" ? expenseCat || null : null,
      nature: direction === "out" && nature ? (nature as "fixed" | "variable" | "non_recurring") : null,
    };
    const r = recurring
      ? await createRecurringItem(companyId, {
          ...common,
          amount: gross,
          payee: null,
          installments: null,
          adjustRate: 0,
          adjustMonth: null,
          frequency: periodicity,
          dueDay: Number(dueDate.slice(8, 10)),
          startMonth: dueDate.slice(0, 7),
          endMonth: endDate.slice(0, 7),
        })
      : entry
        ? await updateEntry(entry.id, { ...common, dueDate, gross })
        : await createManualEntry(companyId, { ...common, dueDate, gross });
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      setFormError(r.error);
      return;
    }
    toast.success(editing ? "Lançamento atualizado." : periodicity === "once" ? "Lançamento criado." : "Lançamentos recorrentes criados.");
    onOpenChange(false);
  }

  const err = (k: string) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2" role="radiogroup" aria-label="Tipo">
            {(["in", "out"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                variant={direction === d ? "default" : "outline"}
                size="sm"
                disabled={editing}
                onClick={() => setDirection(d)}
              >
                {d === "in" ? "Entrada" : "Saída"}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="entry-description">Descrição</Label>
            <Input id="entry-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
            {err("description")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="entry-gross">Valor</Label>
              <Input id="entry-gross" inputMode="decimal" placeholder="0,00" value={gross} onChange={(e) => setGross(e.target.value)} />
              {err("gross")}{err("amount")}
            </div>
            {editing ? null : (
              <div className="flex flex-col gap-1">
                <Label htmlFor="entry-periodicity">Periodicidade</Label>
                <select
                  id="entry-periodicity"
                  className={selectClass}
                  value={periodicity}
                  onChange={(e) => setPeriodicity(e.target.value as typeof periodicity)}
                >
                  <option value="once">Única</option>
                  <option value="monthly">Mensal</option>
                  <option value="quarterly">Trimestral</option>
                  <option value="yearly">Anual</option>
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor="entry-due">{editing ? "Vencimento" : "Início"}</Label>
              <Input id="entry-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              {err("dueDate")}{err("startMonth")}{err("dueDay")}
            </div>
            {!editing && periodicity !== "once" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="entry-end">Fim</Label>
                <Input id="entry-end" type="month" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                {err("endMonth")}
              </div>
            ) : null}
          </div>
          {direction === "in" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="entry-income-cat">Categoria</Label>
              <select id="entry-income-cat" className={selectClass} value={incomeCat} onChange={(e) => setIncomeCat(e.target.value)}>
                <option value="">Escolha…</option>
                <optgroup label="Serviços">
                  {lookups.serviceCategories.map((c) => (
                    <option key={c.id} value={`s:${c.id}`}>{c.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Receitas">
                  {lookups.incomeCategories.map((c) => (
                    <option key={c.id} value={`i:${c.id}`}>{c.name}</option>
                  ))}
                </optgroup>
              </select>
              {err("incomeCategoryId")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="entry-expense-cat">Categoria</Label>
                <select id="entry-expense-cat" className={selectClass} value={expenseCat} onChange={(e) => pickExpenseCategory(e.target.value)}>
                  <option value="">Escolha…</option>
                  {lookups.expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {err("expenseCategoryId")}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="entry-nature">Natureza</Label>
                <select id="entry-nature" className={selectClass} value={nature} onChange={(e) => setNature(e.target.value)}>
                  <option value="">Escolha…</option>
                  {NATURES.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                {err("nature")}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="entry-client">Cliente</Label>
              <select id="entry-client" className={selectClass} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
                <option value="">Nenhum</option>
                {lookups.clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="entry-account">Conta</Label>
              <select id="entry-account" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Conta padrão</option>
                {lookups.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          {formError && Object.keys(errors).length === 0 ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
