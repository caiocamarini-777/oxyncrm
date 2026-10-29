"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createAccount, saveBalanceSnapshot, setAccountActive, updateAccount } from "@/lib/finance/settings-actions";
import type { SettingsData } from "@/lib/finance/queries";
import { formatDate, formatMoney } from "@/lib/records/format";

type Account = SettingsData["accounts"][number];

function BalanceDialog({ account, today, onClose }: { account: Account; today: string; onClose: () => void }) {
  const router = useRouter();
  const [asOf, setAsOf] = useState(today);
  const [balance, setBalance] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    const r = await saveBalanceSnapshot(account.id, asOf, balance, note);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      setFormError(r.error);
      return;
    }
    toast.success("Saldo informado.");
    onClose();
    router.refresh();
  }
  const err = (k: string) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
          <DialogHeader>
            <DialogTitle>Informar saldo — {account.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="snap-date">Data do saldo</Label>
              <Input id="snap-date" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              {err("asOf")}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="snap-balance">Saldo</Label>
              <Input id="snap-balance" inputMode="decimal" placeholder="0,00" value={balance} onChange={(e) => setBalance(e.target.value)} />
              {err("balance")}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="snap-note">Observação (opcional)</Label>
            <Input id="snap-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </div>
          {formError && Object.keys(errors).length === 0 ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar saldo"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AccountRow({ account, canManage, onBalance }: { account: Account; canManage: boolean; onBalance: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(account.name);
  const [bank, setBank] = useState(account.bank ?? "");
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (name === account.name && bank === (account.bank ?? "")) return;
    setError(null);
    startTransition(async () => {
      const r = await updateAccount(account.id, { name, bank });
      if (!r.ok) {
        setError(r.fieldErrors?.name ?? r.error);
        return;
      }
      router.refresh();
    });
  }
  function toggle(active: boolean) {
    startTransition(async () => {
      const r = await setAccountActive(account.id, active);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <li data-testid="account-row" className="flex flex-wrap items-center gap-3 rounded-md border bg-background p-3">
      <Input aria-label={`Nome da conta ${account.name}`} value={name} disabled={pending || !canManage} onChange={(e) => setName(e.target.value)} onBlur={save} className="w-56" />
      <Input aria-label={`Banco de ${account.name}`} placeholder="Banco" value={bank} disabled={pending || !canManage} onChange={(e) => setBank(e.target.value)} onBlur={save} className="w-44" />
      <span className="text-sm text-muted-foreground">
        {account.balance === null ? "Sem saldo informado" : `Saldo ${formatMoney(account.balance)} em ${formatDate(account.balanceAsOf)}`}
      </span>
      {canManage ? (
        <div className="ml-auto flex items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={onBalance} aria-label={`Informar saldo de ${account.name}`}>Informar saldo</Button>
          <Switch
            aria-label={`${account.active ? "Desativar" : "Ativar"} conta ${account.name}`}
            checked={account.active}
            disabled={pending}
            onCheckedChange={toggle}
          />
        </div>
      ) : null}
      {error ? <p role="alert" className="basis-full text-sm text-destructive">{error}</p> : null}
    </li>
  );
}

export function AccountsManager({
  companyId,
  accounts,
  canManage,
  today,
}: {
  companyId: string;
  accounts: Account[];
  canManage: boolean;
  today: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [balanceFor, setBalanceFor] = useState<Account | null>(null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    startTransition(async () => {
      const r = await createAccount(companyId, { name, bank });
      if (!r.ok) {
        setCreateError(r.fieldErrors?.name ?? r.error);
        return;
      }
      setName("");
      setBank("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border p-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-name">Nova conta</Label>
            <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="account-bank">Banco</Label>
            <Input id="account-bank" value={bank} onChange={(e) => setBank(e.target.value)} className="w-44" />
          </div>
          <Button type="submit">Adicionar conta</Button>
          {createError ? <p role="alert" className="basis-full text-sm text-destructive">{createError}</p> : null}
        </form>
      ) : null}
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma conta cadastrada.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <AccountRow key={`${a.id}:${a.name}:${a.bank}:${a.active}`} account={a} canManage={canManage} onBalance={() => setBalanceFor(a)} />
          ))}
        </ul>
      )}
      {balanceFor ? <BalanceDialog account={balanceFor} today={today} onClose={() => setBalanceFor(null)} /> : null}
    </div>
  );
}
