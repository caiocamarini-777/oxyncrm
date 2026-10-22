"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Valores do contrato como digitados (strings), no formato que `updateContract` recebe. */
export type ContractValues = {
  setupTotal: string;
  setupInstallments: string;
  setupFirstDue: string;
  mrr: string;
  mrrStart: string;
  contractMonths: string;
};

export type ContractSource = {
  setupTotal: number;
  setupInstallments: number;
  setupFirstDue: string | null;
  mrr: number;
  mrrStart: string | null;
  contractMonths: number | null;
};

/** Número para o campo de valor ("1500,5"); zero ou vazio viram "". */
export const moneyText = (v: number | null) => (v === null || v === 0 ? "" : String(v).replace(".", ","));

export function contractValuesFrom(d: ContractSource): ContractValues {
  return {
    setupTotal: moneyText(d.setupTotal),
    setupInstallments: String(d.setupInstallments || 1),
    setupFirstDue: d.setupFirstDue ?? "",
    mrr: moneyText(d.mrr),
    mrrStart: d.mrrStart ?? "",
    contractMonths: d.contractMonths === null ? "" : String(d.contractMonths),
  };
}

const FROM_ITEMS = "Calculado a partir dos produtos";

/**
 * Campos do contrato (setup, parcelas, 1ª parcela, MRR, início, duração), usados no cartão Contrato
 * e no diálogo de campos obrigatórios. `fromItems` deixa somente leitura o tipo que tem produtos.
 */
export function ContractFields({
  idPrefix,
  values,
  onChange,
  errors = {},
  fromItems = { setup: false, mrr: false },
}: {
  idPrefix: string;
  values: ContractValues;
  onChange: (key: keyof ContractValues, value: string) => void;
  errors?: Record<string, string>;
  fromItems?: { setup: boolean; mrr: boolean };
}) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const set = (k: keyof ContractValues) => (e: React.ChangeEvent<HTMLInputElement>) => onChange(k, e.target.value);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field id={id("setup")} label="Setup total (R$)" error={errors.setupTotal} hint={fromItems.setup ? FROM_ITEMS : undefined}>
        <Input
          id={id("setup")}
          inputMode="decimal"
          placeholder="0,00"
          value={values.setupTotal}
          readOnly={fromItems.setup}
          onChange={set("setupTotal")}
        />
      </Field>
      <Field id={id("installments")} label="Parcelas" error={errors.setupInstallments}>
        <Input id={id("installments")} type="number" min={1} max={60} value={values.setupInstallments} onChange={set("setupInstallments")} />
      </Field>
      <Field id={id("first-due")} label="Mês da 1ª parcela" error={errors.setupFirstDue}>
        <Input id={id("first-due")} type="month" value={values.setupFirstDue} onChange={set("setupFirstDue")} />
      </Field>
      <span />
      <Field id={id("mrr")} label="MRR (R$)" error={errors.mrr} hint={fromItems.mrr ? FROM_ITEMS : undefined}>
        <Input
          id={id("mrr")}
          inputMode="decimal"
          placeholder="0,00"
          value={values.mrr}
          readOnly={fromItems.mrr}
          onChange={set("mrr")}
        />
      </Field>
      <Field id={id("mrr-start")} label="Início do MRR" error={errors.mrrStart}>
        <Input id={id("mrr-start")} type="month" value={values.mrrStart} onChange={set("mrrStart")} />
      </Field>
      <Field id={id("months")} label="Duração (meses)" error={errors.contractMonths}>
        <Input id={id("months")} type="number" min={1} max={120} value={values.contractMonths} onChange={set("contractMonths")} />
      </Field>
    </div>
  );
}

/** Rótulo, campo, dica e erro. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
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
