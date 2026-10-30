"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRecurringItem, setRecurringItemActive, updateRecurringItem } from "@/lib/finance/expenses-actions";
import { FREQUENCY_LABEL, toInput } from "@/lib/finance/labels";
import { formatMonth } from "@/lib/finance/months";
import type { RecurringItemRow } from "@/lib/finance/queries";
import { createExpenseCategory } from "@/lib/finance/settings-actions";
import { formatMoney } from "@/lib/records/format";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const NATURES = [
  { id: "fixed", name: "Fixa" },
  { id: "variable", name: "Variável" },
  { id: "non_recurring", name: "Não recorrente" },
];
const NEW = "__new__";

type Category = { id: string; name: string; defaultNature: "fixed" | "variable" | "non_recurring" };
type Account = { id: string; name: string };
type Named = { id: string; name: string };
export type RecurringLookups = {
  incomeCategories: Named[];
  serviceCategories: Named[];
  clients: Named[];
};

export function ExpenseCategorySelect({
  companyId,
  categories,
  value,
  onChange,
  canCreate,
  id,
  defaultNature,
}: {
  companyId: string;
  categories: Category[];
  value: string;
  onChange: (id: string, category?: Category) => void;
  canCreate: boolean;
  id?: string;
  defaultNature: string;
}) {
  const [extra, setExtra] = useState<Category[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = [...categories, ...extra.filter((x) => !categories.some((c) => c.id === x.id))];

  async function create() {
    setBusy(true);
    setError(null);
    const nature = (defaultNature || "fixed") as Category["defaultNature"];
    const r = await createExpenseCategory(companyId, { name, defaultNature: nature });
    setBusy(false);
    if (!r.ok) return setError(r.fieldErrors?.name ?? r.error);
    const cat = { id: r.data.id, name: name.trim(), defaultNature: nature };
    setExtra((x) => [...x, cat]);
    setName("");
    setCreating(false);
    onChange(cat.id, cat);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        id={id}
        className={selectClass}
        value={creating ? NEW : value}
        onChange={(e) => {
          if (e.target.value === NEW) return setCreating(true);
          setCreating(false);
          onChange(e.target.value, all.find((c) => c.id === e.target.value));
        }}
      >
        <option value="">Escolha…</option>
        {all.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        {canCreate ? <option value={NEW}>Nova categoria…</option> : null}
      </select>
      {creating ? (
        <div className="flex gap-2">
          <Input
            aria-label="Nome da nova categoria"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
          />
          <Button type="button" size="sm" disabled={busy} onClick={create}>Criar</Button>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function ExpenseDialog({
  companyId,
  categories,
  accounts,
  lookups,
  canManage,
  expense,
  open,
  onOpenChange,
  startDefault,
}: {
  companyId: string;
  categories: Category[];
  accounts: Account[];
  lookups: RecurringLookups;
  canManage: boolean;
  expense?: RecurringItemRow;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  startDefault: string;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"in" | "out">(expense?.direction ?? "out");
  const [organizationId, setOrganizationId] = useState(expense?.organizationId ?? "");
  // Entrada: "s:<serviço>" ou "i:<categoria de receita>".
  const [incomeCat, setIncomeCat] = useState(
    expense?.serviceCategoryId ? `s:${expense.serviceCategoryId}` : expense?.incomeCategoryId ? `i:${expense.incomeCategoryId}` : "",
  );
  const [description, setDescription] = useState(expense?.description ?? "");
  const [payee, setPayee] = useState(expense?.payee ?? "");
  const [categoryId, setCategoryId] = useState(expense?.expenseCategoryId ?? "");
  const [nature, setNature] = useState<string>(expense?.nature ?? "");
  const [amount, setAmount] = useState(expense ? toInput(expense.amount) : "");
  const [frequency, setFrequency] = useState<string>(expense?.frequency ?? "monthly");
  const [dueDay, setDueDay] = useState(expense ? String(expense.dueDay) : "");
  const [startMonth, setStartMonth] = useState(expense?.startMonth.slice(0, 7) ?? startDefault);
  const [endMonth, setEndMonth] = useState(expense?.endMonth?.slice(0, 7) ?? "");
  const [installments, setInstallments] = useState(expense?.installments ? String(expense.installments) : "");
  const [adjustRate, setAdjustRate] = useState(expense && expense.adjustRate > 0 ? String(expense.adjustRate).replace(".", ",") : "");
  const [adjustMonth, setAdjustMonth] = useState(expense?.adjustMonth ? String(expense.adjustMonth) : "");
  const [accountId, setAccountId] = useState(expense?.accountId ?? "");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const err = (k: string) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const input = {
      direction,
      description,
      payee,
      organizationId: organizationId || null,
      incomeCategoryId: direction === "in" && incomeCat.startsWith("i:") ? incomeCat.slice(2) : null,
      serviceCategoryId: direction === "in" && incomeCat.startsWith("s:") ? incomeCat.slice(2) : null,
      expenseCategoryId: direction === "out" ? categoryId : null,
      nature: direction === "out" ? (nature as "fixed") : null,
      amount,
      frequency: frequency as "monthly",
      dueDay,
      startMonth,
      endMonth,
      installments,
      adjustRate,
      adjustMonth,
      accountId: accountId || null,
    };
    const r = expense ? await updateRecurringItem(expense.id, input) : await createRecurringItem(companyId, input);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      setFormError(r.error);
      return;
    }
    toast.success(expense ? "Item atualizado." : "Item criado.");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <DialogHeader>
            <DialogTitle>{expense ? "Editar item recorrente" : "Novo item recorrente"}</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2" role="radiogroup" aria-label="Sentido">
            {(["in", "out"] as const).map((d) => (
              <Button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                variant={direction === d ? "default" : "outline"}
                size="sm"
                disabled={!!expense}
                onClick={() => setDirection(d)}
              >
                {d === "in" ? "Entrada" : "Saída"}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-description">Descrição</Label>
              <Input id="exp-description" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
              {err("description")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-payee">Favorecido</Label>
              <Input id="exp-payee" value={payee} maxLength={200} onChange={(e) => setPayee(e.target.value)} />
            </div>
            {direction === "out" ? (
              <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="exp-category">Categoria</Label>
                <ExpenseCategorySelect
                  id="exp-category"
                  companyId={companyId}
                  categories={categories}
                  value={categoryId}
                  canCreate={canManage}
                  defaultNature={nature}
                  onChange={(id, c) => {
                    setCategoryId(id);
                    if (c && !nature) setNature(c.defaultNature);
                  }}
                />
                {err("expenseCategoryId")}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="exp-nature">Natureza</Label>
                <select id="exp-nature" className={selectClass} value={nature} onChange={(e) => setNature(e.target.value)}>
                  <option value="">Escolha…</option>
                  {NATURES.map((n) => (
                    <option key={n.id} value={n.id}>{n.name}</option>
                  ))}
                </select>
                {err("nature")}
              </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="exp-income-cat">Categoria</Label>
                  <select id="exp-income-cat" className={selectClass} value={incomeCat} onChange={(e) => setIncomeCat(e.target.value)}>
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
                <div className="flex flex-col gap-1">
                  <Label htmlFor="exp-client">Cliente</Label>
                  <select id="exp-client" className={selectClass} value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
                    <option value="">Nenhum</option>
                    {lookups.clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-amount">Valor</Label>
              <Input id="exp-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {err("amount")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-frequency">Frequência</Label>
              <select id="exp-frequency" className={selectClass} value={frequency} onChange={(e) => setFrequency(e.target.value)}>
                {Object.entries(FREQUENCY_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-day">Dia de vencimento</Label>
              <Input id="exp-day" inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
              {err("dueDay")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-account">Conta</Label>
              <select id="exp-account" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Conta padrão</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-start">Início</Label>
              <Input id="exp-start" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
              {err("startMonth")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-end">Fim</Label>
              <Input id="exp-end" type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
              {err("endMonth")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="exp-installments">Parcelas (opcional)</Label>
              <Input id="exp-installments" inputMode="numeric" value={installments} onChange={(e) => setInstallments(e.target.value)} />
              {err("installments")}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="exp-adjust">Reajuste (%)</Label>
                <Input id="exp-adjust" inputMode="decimal" value={adjustRate} onChange={(e) => setAdjustRate(e.target.value)} />
                {err("adjustRate")}
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="exp-adjust-month">Mês do reajuste</Label>
                <Input id="exp-adjust-month" inputMode="numeric" placeholder="1 a 12" value={adjustMonth} onChange={(e) => setAdjustMonth(e.target.value)} />
                {err("adjustMonth")}
              </div>
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

/** Lista de despesas recorrentes com criação, edição e ativação. */
export function ExpensesManager({
  companyId,
  expenses,
  categories,
  accounts,
  lookups,
  canManage,
  startDefault,
}: {
  companyId: string;
  expenses: RecurringItemRow[];
  categories: Category[];
  accounts: Account[];
  lookups: RecurringLookups;
  canManage: boolean;
  startDefault: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RecurringItemRow | null>(null);
  const categoryOf = (e: RecurringItemRow) => {
    if (e.direction === "out") return categories.find((c) => c.id === e.expenseCategoryId)?.name ?? "—";
    return (
      lookups.serviceCategories.find((c) => c.id === e.serviceCategoryId)?.name ??
      lookups.incomeCategories.find((c) => c.id === e.incomeCategoryId)?.name ??
      "—"
    );
  };
  const natureName = (n: string | null) => (n ? (NATURES.find((x) => x.id === n)?.name ?? n) : "—");

  async function toggle(e: RecurringItemRow) {
    const r = await setRecurringItemActive(e.id, !e.active);
    if (!r.ok) return toast.error(r.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div>
          <Button type="button" size="sm" onClick={() => setCreating(true)}>Novo item</Button>
        </div>
      ) : null}
      {expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum item recorrente cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Descrição</th>
                <th className="px-3 py-2">Sentido</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2">Natureza</th>
                <th className="px-3 py-2">Frequência</th>
                <th className="px-3 py-2">Início</th>
                <th className="px-3 py-2">Fim</th>
                <th className="px-3 py-2">Dia</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Situação</th>
                {canManage ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{e.description}</td>
                  <td className="px-3 py-2">{e.direction === "in" ? "Entrada" : "Saída"}</td>
                  <td className="px-3 py-2">{categoryOf(e)}</td>
                  <td className="px-3 py-2">{natureName(e.nature)}</td>
                  <td className="px-3 py-2">{FREQUENCY_LABEL[e.frequency]}</td>
                  <td className="px-3 py-2">{formatMonth(e.startMonth)}</td>
                  <td className="px-3 py-2">
                    {e.endMonth ? formatMonth(e.endMonth) : <Badge variant="outline">Defina o fim</Badge>}
                  </td>
                  <td className="px-3 py-2">{e.dueDay}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(e.amount)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={e.active ? "secondary" : "outline"}>{e.active ? "Ativa" : "Inativa"}</Badge>
                  </td>
                  {canManage ? (
                    <td className="flex gap-1 px-3 py-2">
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(e)}>Editar</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => toggle(e)}>{e.active ? "Desativar" : "Ativar"}</Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating ? (
        <ExpenseDialog companyId={companyId} categories={categories} accounts={accounts} lookups={lookups} canManage={canManage} open onOpenChange={setCreating} startDefault={startDefault} />
      ) : null}
      {editing ? (
        <ExpenseDialog
          key={editing.id}
          companyId={companyId}
          categories={categories}
          accounts={accounts}
          lookups={lookups}
          canManage={canManage}
          expense={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          startDefault={startDefault}
        />
      ) : null}
    </div>
  );
}
