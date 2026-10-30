"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EntryRow } from "@/lib/finance/calc";
import { cancelEntry, reopenEntry } from "@/lib/finance/entries-actions";
import { NATURE_LABEL, STATUS_LABEL } from "@/lib/finance/export";
import { formatDate, formatMoney } from "@/lib/records/format";
import { cn } from "cn";
import { ChangeBadge } from "./change-badge";
import { EntryDialog, type EntryDialogLookups } from "./entry-dialog";
import { SettleDialog } from "./settle-dialog";

export function StatusBadge({ entry, today }: { entry: EntryRow; today: string }) {
  const overdue = entry.status === "open" && entry.dueDate < today;
  return (
    <Badge variant={overdue ? "destructive" : entry.status === "settled" ? "secondary" : "outline"}>
      {overdue ? "Vencido" : STATUS_LABEL[entry.status]}
    </Badge>
  );
}

const name = (list: { id: string; name: string }[], id: string | null) => (id ? (list.find((x) => x.id === id)?.name ?? "") : "");

export function categoryName(e: EntryRow, l: EntryDialogLookups): string {
  return e.direction === "in"
    ? name(l.serviceCategories, e.serviceCategoryId) || name(l.incomeCategories, e.incomeCategoryId)
    : name(l.expenseCategories, e.expenseCategoryId);
}

/** Tabela de Lançamentos: seleção para baixa em lote, edição, cancelamento e reabertura. */
export function EntriesTable({
  entries,
  lookups,
  companyId,
  today,
  canManage,
}: {
  entries: EntryRow[];
  lookups: EntryDialogLookups;
  companyId: string;
  today: string;
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [settleIds, setSettleIds] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<EntryRow | null>(null);
  const [creating, setCreating] = useState(false);

  const openIds = entries.filter((e) => e.status === "open").map((e) => e.id);
  const allSelected = openIds.length > 0 && openIds.every((id) => selected.includes(id));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    const r = await fn();
    if (!r.ok) toast.error(r.error ?? "Não foi possível concluir.");
    else toast.success(okMsg);
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setCreating(true)}>Novo lançamento</Button>
          <Button type="button" size="sm" variant="outline" disabled={selected.length === 0} onClick={() => setSettleIds(selected)}>
            Liquidar selecionados{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {canManage ? (
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos em aberto"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? [] : openIds)}
                  />
                </th>
              ) : null}
              <th className="px-3 py-2">Vencimento</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Categoria</th>
              <th className="px-3 py-2">Natureza</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Liquidado em</th>
              {canManage ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 10 : 8} className="px-3 py-6 text-center text-muted-foreground">
                  Nenhum lançamento no período.
                </td>
              </tr>
            ) : null}
            {entries.map((e) => (
              <tr key={e.id} className={cn("border-t", e.status === "cancelled" && "text-muted-foreground line-through")}>
                {canManage ? (
                  <td className="px-3 py-2">
                    {e.status === "open" ? (
                      <input type="checkbox" aria-label={`Selecionar ${e.description ?? "lançamento"}`} checked={selected.includes(e.id)} onChange={() => toggle(e.id)} />
                    ) : null}
                  </td>
                ) : null}
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(e.dueDate)}</td>
                <td className="px-3 py-2">
                  {e.description ?? ""}
                  <ChangeBadge entry={e} />
                </td>
                <td className="px-3 py-2">{name(lookups.clients, e.organizationId)}</td>
                <td className="px-3 py-2">{categoryName(e, lookups)}</td>
                <td className="px-3 py-2">{e.nature ? NATURE_LABEL[e.nature] : ""}</td>
                <td className={cn("px-3 py-2 text-right whitespace-nowrap tabular-nums", e.direction === "out" ? "text-destructive" : "")}>
                  {e.direction === "out" ? "−" : ""}
                  {formatMoney(e.status === "settled" ? (e.settledAmount ?? e.amount) : e.amount)}
                </td>
                <td className="px-3 py-2"><StatusBadge entry={e} today={today} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{formatDate(e.settledOn)}</td>
                {canManage ? (
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    {e.status === "open" ? (
                      <>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSettleIds([e.id])}>Liquidar</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(e)}>Editar</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => run(() => cancelEntry(e.id), "Lançamento cancelado.")}>Cancelar</Button>
                      </>
                    ) : null}
                    {e.status === "settled" ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => run(() => reopenEntry(e.id), "Lançamento reaberto.")}>Reabrir</Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {settleIds ? (
        <SettleDialog
          key={settleIds.join(",")}
          ids={settleIds}
          defaultAmount={settleIds.length === 1 ? (entries.find((e) => e.id === settleIds[0])?.amount ?? null) : null}
          today={today}
          accounts={lookups.accounts}
          open
          onOpenChange={(o) => !o && setSettleIds(null)}
          onDone={() => setSelected([])}
        />
      ) : null}
      {creating ? (
        <EntryDialog companyId={companyId} lookups={lookups} today={today} open onOpenChange={(o) => !o && setCreating(false)} />
      ) : null}
      {editing ? (
        <EntryDialog key={editing.id} companyId={companyId} lookups={lookups} today={today} entry={editing} open onOpenChange={(o) => !o && setEditing(null)} />
      ) : null}
    </div>
  );
}
