"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  acknowledgeSourceChange,
  activateContract,
  cancelContract,
  createContract,
  saveContractLines,
  updateContract,
} from "@/lib/finance/contracts-actions";
import { ADJUST_KIND_LABEL, END_RULE_LABEL, toInput } from "@/lib/finance/labels";
import type { ContractDetail } from "@/lib/finance/queries";
import { ContractLinesEditor, type LineDraft } from "./contract-lines-editor";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function toDrafts(c: ContractDetail): LineDraft[] {
  return c.lines.map((l) => ({
    kind: l.kind,
    description: l.description,
    serviceCategoryId: l.serviceCategoryId,
    amount: toInput(l.amount),
    firstMonth: l.firstMonth.slice(0, 7),
    installments: String(l.installments),
    months: l.months === null ? "" : String(l.months),
    setupRate: l.setupRate === null ? "" : String(l.setupRate).replace(".", ","),
    recurringRate: l.recurringRate === null ? "" : String(l.recurringRate).replace(".", ","),
    estimatedMonthly: toInput(l.estimatedMonthly),
  }));
}

/** Novo contrato avulso (sem negócio): pede só o título e abre o detalhe. */
export function NewContractForm({ companyId, empresa }: { companyId: string; empresa: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await createContract(companyId, {
      title,
      dueDay: null,
      retentionRate: 0,
      endRule: null,
      renewalMonths: null,
      adjustKind: "none",
      adjustIndex: null,
      adjustRate: 0,
      notes: null,
    });
    setBusy(false);
    if (!r.ok) return setError(r.fieldErrors?.title ?? r.error);
    router.push(`/${empresa}/financeiro/contratos/${r.data.id}`);
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-contract-title">Novo contrato</Label>
        <Input id="new-contract-title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-72" placeholder="Título" />
      </div>
      <Button type="submit" size="sm" disabled={busy}>Criar contrato</Button>
      {error ? <p role="alert" className="basis-full text-sm text-destructive">{error}</p> : null}
    </form>
  );
}

export function ContractForm({
  contract,
  empresa,
  organizations,
  accounts,
  canManage,
  canCreateServiceCategory,
  defaultMonth,
}: {
  contract: ContractDetail;
  empresa: string;
  organizations: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
  canManage: boolean;
  canCreateServiceCategory: boolean;
  defaultMonth: string;
}) {
  const router = useRouter();
  const editable = canManage && (contract.status === "draft" || contract.status === "active");
  const [title, setTitle] = useState(contract.title);
  const [organizationId, setOrganizationId] = useState(contract.organizationId ?? "");
  const [dueDay, setDueDay] = useState(contract.dueDay === null ? "" : String(contract.dueDay));
  const [retention, setRetention] = useState(String(contract.retentionRate).replace(".", ","));
  const [accountId, setAccountId] = useState(contract.accountId ?? "");
  const [endRule, setEndRule] = useState<string>(contract.endRule ?? "");
  const [renewalMonths, setRenewalMonths] = useState(contract.renewalMonths === null ? "" : String(contract.renewalMonths));
  const [adjustKind, setAdjustKind] = useState<string>(contract.adjustKind);
  const [adjustIndex, setAdjustIndex] = useState<string>(contract.adjustIndex ?? "");
  const [adjustRate, setAdjustRate] = useState(String(contract.adjustRate).replace(".", ","));
  const [notes, setNotes] = useState(contract.notes ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() => toDrafts(contract));
  const [initialLines] = useState(() => JSON.stringify(toDrafts(contract)));
  const [savedLines, setSavedLines] = useState(initialLines);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const err = (k: string) => (errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null);

  /** Salva o contrato e, se mudaram, as linhas. Devolve false (e mostra o erro) se algo falhar. */
  async function save(): Promise<boolean> {
    setErrors({});
    setFormError(null);
    const r = await updateContract(contract.id, {
      title,
      organizationId: organizationId || null,
      dueDay,
      retentionRate: retention,
      accountId: accountId || null,
      endRule: endRule || null,
      renewalMonths,
      adjustKind: adjustKind as "none",
      adjustIndex: adjustIndex || null,
      adjustRate,
      notes,
    });
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      setFormError(r.error);
      return false;
    }
    const current = JSON.stringify(lines);
    if (current !== savedLines) {
      const l = await saveContractLines(contract.id, lines);
      if (!l.ok) {
        setErrors(l.fieldErrors ?? {});
        setFormError(l.error);
        return false;
      }
      setSavedLines(current);
    }
    return true;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await save();
    setBusy(false);
    if (ok) {
      toast.success("Contrato salvo.");
      router.refresh();
    }
  }

  async function onActivate() {
    setBusy(true);
    const ok = await save();
    if (ok) {
      const r = await activateContract(contract.id);
      if (!r.ok) setFormError(r.error);
      else {
        toast.success("Contrato ativado.");
        router.refresh();
      }
    }
    setBusy(false);
  }

  async function onCancel() {
    if (!window.confirm("Cancelar este contrato? Os lançamentos em aberto serão removidos.")) return;
    setBusy(true);
    const r = await cancelContract(contract.id);
    setBusy(false);
    if (!r.ok) return setFormError(r.error);
    toast.success("Contrato cancelado.");
    router.refresh();
  }

  async function onAcknowledge() {
    const r = await acknowledgeSourceChange(contract.id);
    if (!r.ok) return toast.error(r.error);
    router.refresh();
  }

  const off = !editable || busy;

  return (
    <div className="flex flex-col gap-4">
      {contract.sourceChanged ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <span>O negócio de origem mudou.</span>
          {contract.dealId ? (
            <Link href={`/${empresa}/negocios/${contract.dealId}`} className="underline">
              Abrir o negócio
            </Link>
          ) : null}
          {canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={onAcknowledge}>Ciente</Button>
          ) : null}
        </div>
      ) : null}

      <form onSubmit={onSave} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="contract-title">Título</Label>
            <Input id="contract-title" value={title} disabled={off} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            {err("title")}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="contract-client">Cliente</Label>
            <select id="contract-client" className={selectClass} value={organizationId} disabled={off} onChange={(e) => setOrganizationId(e.target.value)}>
              <option value="">Escolha…</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="contract-due-day">Dia de vencimento</Label>
            <Input id="contract-due-day" inputMode="numeric" value={dueDay} disabled={off} onChange={(e) => setDueDay(e.target.value)} />
            {err("dueDay")}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="contract-account">Conta</Label>
            <select id="contract-account" className={selectClass} value={accountId} disabled={off} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Escolha…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="contract-retention">Retenção (%)</Label>
            <Input id="contract-retention" inputMode="decimal" value={retention} disabled={off} onChange={(e) => setRetention(e.target.value)} />
            {err("retentionRate")}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="contract-end-rule">Regra de fim de vigência</Label>
            <select id="contract-end-rule" className={selectClass} value={endRule} disabled={off} onChange={(e) => setEndRule(e.target.value)}>
              <option value="">Escolha…</option>
              {Object.entries(END_RULE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            {err("endRule")}
          </div>
          {endRule && endRule !== "ends" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="contract-renewal">Meses por renovação</Label>
              <Input id="contract-renewal" inputMode="numeric" value={renewalMonths} disabled={off} onChange={(e) => setRenewalMonths(e.target.value)} />
              {err("renewalMonths")}
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <Label htmlFor="contract-adjust-kind">Reajuste</Label>
            <select id="contract-adjust-kind" className={selectClass} value={adjustKind} disabled={off} onChange={(e) => setAdjustKind(e.target.value)}>
              {Object.entries(ADJUST_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
          {adjustKind === "index" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="contract-adjust-index">Índice</Label>
              <select id="contract-adjust-index" className={selectClass} value={adjustIndex} disabled={off} onChange={(e) => setAdjustIndex(e.target.value)}>
                <option value="">Escolha…</option>
                {["IPCA", "IGP-M", "INPC"].map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
              {err("adjustIndex")}
            </div>
          ) : null}
          {adjustKind !== "none" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="contract-adjust-rate">{adjustKind === "index" ? "Spread (%)" : "Reajuste (%)"}</Label>
              <Input id="contract-adjust-rate" inputMode="decimal" value={adjustRate} disabled={off} onChange={(e) => setAdjustRate(e.target.value)} />
              {err("adjustRate")}
            </div>
          ) : null}
          <div className="flex flex-col gap-1 md:col-span-3">
            <Label htmlFor="contract-notes">Observações</Label>
            <Textarea id="contract-notes" value={notes} disabled={off} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <section className="flex flex-col gap-2" aria-label="Linhas do contrato">
          <h2 className="font-heading text-base font-semibold">Linhas</h2>
          <ContractLinesEditor
            companyId={contract.companyId}
            lines={lines}
            onChange={setLines}
            errors={errors}
            defaultMonth={defaultMonth}
            canCreateServiceCategory={canCreateServiceCategory}
            disabled={off}
          />
        </section>

        {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar"}</Button>
            {contract.status === "draft" ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={onActivate}>Ativar</Button>
            ) : null}
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancelar contrato</Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
