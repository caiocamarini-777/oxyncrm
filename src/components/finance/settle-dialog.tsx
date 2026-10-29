"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { settleEntries } from "@/lib/finance/entries-actions";

const selectClass = "h-8 w-full rounded-lg border bg-background px-2 text-sm";

/** Baixa de um ou mais lançamentos. O valor só pode ser alterado quando é um só. */
export function SettleDialog({
  ids,
  defaultAmount,
  today,
  accounts,
  open,
  onOpenChange,
  onDone,
}: {
  ids: string[];
  /** Valor sugerido (só para um lançamento). */
  defaultAmount: number | null;
  today: string;
  accounts: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
}) {
  const [settledOn, setSettledOn] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const single = ids.length === 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await settleEntries({
      ids,
      settledOn,
      accountId: accountId || null,
      amount: single && amount.trim() !== "" ? amount : null,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    const missed = ids.length - r.data.count;
    if (missed > 0) {
      toast.warning(
        `${r.data.count} liquidado(s). ${missed} não ${missed === 1 ? "foi liquidado" : "foram liquidados"}: já não estavam em aberto.`,
      );
    } else {
      toast.success(r.data.count === 1 ? "Lançamento liquidado." : `${r.data.count} lançamentos liquidados.`);
    }
    onOpenChange(false);
    onDone?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Liquidar {ids.length === 1 ? "lançamento" : `${ids.length} lançamentos`}</DialogTitle>
            <DialogDescription>Informe quando o dinheiro entrou ou saiu.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="settle-on">Liquidado em</Label>
            <Input id="settle-on" type="date" value={settledOn} onChange={(e) => setSettledOn(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="settle-account">Conta</Label>
            <select id="settle-account" className={selectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Manter a conta do lançamento</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          {single ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="settle-amount">Valor liquidado</Label>
              <Input
                id="settle-amount"
                inputMode="decimal"
                placeholder={defaultAmount !== null ? defaultAmount.toFixed(2).replace(".", ",") : "0,00"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Deixe em branco para usar o valor do lançamento.</p>
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Liquidando…" : "Liquidar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
