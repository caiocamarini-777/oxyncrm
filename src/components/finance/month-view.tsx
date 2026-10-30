"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { buttonVariants, Button } from "@/components/ui/button";
import type { EntryRow } from "@/lib/finance/calc";
import { formatDate, formatMoney } from "@/lib/records/format";
import { weekdayShort } from "@/lib/finance/dates";
import { cn } from "cn";
import { categoryName } from "./entries-table";
import type { EntryDialogLookups } from "./entry-dialog";
import { EntryDialog } from "./entry-dialog";
import { SettleDialog } from "./settle-dialog";

export type MonthDay = { date: string; balance: number; entries: EntryRow[] };

function Card({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", negative && "text-destructive")}>{formatMoney(value)}</p>
    </div>
  );
}

/** Mês: cards, navegação e lista por dia com o saldo corrido; baixa em lote dos itens em aberto. */
export function MonthView({
  label,
  prevHref,
  nextHref,
  cards,
  days,
  lookups,
  companyId,
  today,
  canManage,
}: {
  label: string;
  prevHref: string;
  nextHref: string;
  cards: { current: number; receivable: number; payable: number; projected: number } | null;
  days: MonthDay[];
  lookups: EntryDialogLookups;
  companyId: string;
  today: string;
  canManage: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [settleIds, setSettleIds] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const clientName = (id: string | null) => (id ? (lookups.clients.find((c) => c.id === id)?.name ?? "") : "");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link href={prevHref} aria-label="Mês anterior" className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
            <ChevronLeft />
          </Link>
          <h2 className="min-w-40 text-center font-heading text-lg font-medium capitalize">{label}</h2>
          <Link href={nextHref} aria-label="Próximo mês" className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
            <ChevronRight />
          </Link>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>Novo lançamento</Button>
            <Button type="button" size="sm" disabled={selected.length === 0} onClick={() => setSettleIds(selected)}>
              Liquidar selecionados{selected.length > 0 ? ` (${selected.length})` : ""}
            </Button>
          </div>
        ) : null}
      </div>

      {cards ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card label="Saldo atual" value={cards.current} negative={cards.current < 0} />
          <Card label="A receber" value={cards.receivable} />
          <Card label="A pagar" value={cards.payable} />
          <Card label="Saldo projetado no fim do mês" value={cards.projected} negative={cards.projected < 0} />
        </div>
      ) : null}

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum lançamento neste mês.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {days.map((d) => (
            <li key={d.date} className="overflow-hidden rounded-xl border">
              <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 text-xs">
                <span className="font-medium">
                  {formatDate(d.date)} · {weekdayShort(d.date)}
                  {d.date === today ? " · hoje" : ""}
                </span>
                {cards ? (
                  <span className={cn("tabular-nums", d.balance < 0 && "text-destructive")}>Saldo {formatMoney(d.balance)}</span>
                ) : null}
              </div>
              <ul>
                {d.entries.map((e) => {
                  const overdue = e.status === "open" && e.dueDate < today;
                  return (
                    <li
                      key={e.id}
                      data-overdue={overdue ? "true" : undefined}
                      className={cn("flex items-center gap-3 border-t px-3 py-2 text-sm", overdue && "text-destructive")}
                    >
                      {canManage ? (
                        <input
                          type="checkbox"
                          aria-label={`Selecionar ${e.description ?? "lançamento"}`}
                          disabled={e.status !== "open"}
                          checked={selected.includes(e.id)}
                          onChange={() => toggle(e.id)}
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{e.description ?? "Sem descrição"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[clientName(e.organizationId), categoryName(e, lookups)].filter(Boolean).join(" · ")}
                          {overdue ? ` · venceu em ${formatDate(e.dueDate)}` : ""}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">{e.status === "settled" ? "Liquidado" : "Em aberto"}</span>
                      <span className={cn("w-28 text-right tabular-nums", !overdue && e.direction === "out" && "text-destructive")}>
                        {e.direction === "out" ? "−" : ""}
                        {formatMoney(e.status === "settled" ? (e.settledAmount ?? e.amount) : e.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {settleIds ? (
        <SettleDialog
          key={settleIds.join(",")}
          ids={settleIds}
          defaultAmount={null}
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
    </div>
  );
}
