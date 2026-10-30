"use client";

import { Plus, Trash2 } from "lucide-react";
import { ServiceCategorySelect } from "@/components/records/service-category-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LINE_KIND_LABEL } from "@/lib/finance/labels";
import { shiftMonth, formatMonth, monthCount } from "@/lib/finance/months";

export type LineDraft = {
  /** Id da linha já gravada; ausente em linha nova. */
  id?: string;
  kind: "setup" | "recurring" | "commission";
  description: string;
  serviceCategoryId: string | null;
  amount: string;
  firstMonth: string;
  installments: string;
  months: string;
  setupRate: string;
  recurringRate: string;
  estimatedMonthly: string;
};

export const emptyLine = (firstMonth: string): LineDraft => ({
  kind: "recurring",
  description: "",
  serviceCategoryId: null,
  amount: "",
  firstMonth,
  installments: "1",
  months: "12",
  setupRate: "",
  recurringRate: "",
  estimatedMonthly: "",
});

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/** Fim (mês) de uma linha com duração; "" se a duração não é um número válido. */
function endOf(l: LineDraft, defaultMonth: string): string {
  const n = Number(l.months);
  if (l.months.trim() === "" || !Number.isInteger(n) || n < 1) return "";
  return shiftMonth(l.firstMonth || defaultMonth, n - 1);
}

/** Mensagem do erro de duração, dita em termos de início e fim. */
function endError(l: LineDraft, serverMessage: string | undefined): string | null {
  if (!serverMessage) return null;
  if (l.months.trim() === "") return "Informe o fim.";
  if (Number(l.months) < 1) return "O fim não pode ser antes do início.";
  return serverMessage;
}

/** Linhas do contrato. Os campos de % e a estimativa aparecem só no tipo Comissão. */
export function ContractLinesEditor({
  companyId,
  lines,
  onChange,
  errors,
  defaultMonth,
  canCreateServiceCategory,
  disabled,
}: {
  companyId: string;
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  errors: Record<string, string>;
  defaultMonth: string;
  canCreateServiceCategory: boolean;
  disabled: boolean;
}) {
  const set = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const err = (i: number, k: string) => (errors[`${i}.${k}`] ? <p className="text-xs text-destructive">{errors[`${i}.${k}`]}</p> : null);

  return (
    <div className="flex flex-col gap-3">
      {lines.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma linha. Adicione ao menos uma para ativar.</p> : null}
      {lines.map((l, i) => {
        const n = i + 1;
        return (
          <div key={i} className="grid gap-3 rounded-xl border p-3 md:grid-cols-6" data-testid="contract-line">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`line-kind-${i}`}>Tipo (linha {n})</Label>
              <select
                id={`line-kind-${i}`}
                className={selectClass}
                value={l.kind}
                disabled={disabled}
                onChange={(e) => set(i, { kind: e.target.value as LineDraft["kind"] })}
              >
                {Object.entries(LINE_KIND_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label htmlFor={`line-desc-${i}`}>Descrição (linha {n})</Label>
              <Input id={`line-desc-${i}`} value={l.description} disabled={disabled} maxLength={200} onChange={(e) => set(i, { description: e.target.value })} />
              {err(i, "description")}
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <Label htmlFor={`line-cat-${i}`}>Categoria de serviço (linha {n})</Label>
              <ServiceCategorySelect
                id={`line-cat-${i}`}
                companyId={companyId}
                value={l.serviceCategoryId}
                onChange={(v) => set(i, { serviceCategoryId: v })}
                allowCreate={canCreateServiceCategory}
                disabled={disabled}
                emptyLabel="Escolha…"
              />
            </div>
            <div className="flex items-end justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover linha ${n}`}
                disabled={disabled}
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>

            {l.kind !== "commission" ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`line-amount-${i}`}>Valor (linha {n})</Label>
                <Input id={`line-amount-${i}`} inputMode="decimal" placeholder="0,00" value={l.amount} disabled={disabled} onChange={(e) => set(i, { amount: e.target.value })} />
                {err(i, "amount")}
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <Label htmlFor={`line-first-${i}`}>Início (linha {n})</Label>
              <Input id={`line-first-${i}`} type="month" value={l.firstMonth || defaultMonth} disabled={disabled} onChange={(e) => set(i, { firstMonth: e.target.value })} />
              {err(i, "firstMonth")}
            </div>
            {l.kind === "setup" ? (
              <>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`line-inst-${i}`}>Parcelas (linha {n})</Label>
                <Input id={`line-inst-${i}`} inputMode="numeric" value={l.installments} disabled={disabled} onChange={(e) => set(i, { installments: e.target.value })} />
                {err(i, "installments")}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Fim (linha {n})</span>
                <p className="flex h-9 items-center text-sm text-muted-foreground" data-testid={`line-setup-end-${i}`}>
                  {Number.isInteger(Number(l.installments)) && Number(l.installments) >= 1
                    ? formatMonth(shiftMonth(l.firstMonth || defaultMonth, Number(l.installments) - 1))
                    : "—"}
                </p>
              </div>
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <Label htmlFor={`line-end-${i}`}>Fim (linha {n})</Label>
                <Input
                  id={`line-end-${i}`}
                  type="month"
                  value={endOf(l, defaultMonth)}
                  disabled={disabled}
                  onChange={(e) =>
                    set(i, { months: e.target.value ? String(monthCount(l.firstMonth || defaultMonth, e.target.value)) : "" })
                  }
                />
                {endError(l, errors[`${i}.months`]) ? <p className="text-xs text-destructive">{endError(l, errors[`${i}.months`])}</p> : null}
              </div>
            )}
            {l.kind === "commission" ? (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`line-srate-${i}`}>% sobre o setup (linha {n})</Label>
                  <Input id={`line-srate-${i}`} inputMode="decimal" value={l.setupRate} disabled={disabled} onChange={(e) => set(i, { setupRate: e.target.value })} />
                  {err(i, "setupRate")}
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`line-rrate-${i}`}>% sobre o recorrente (linha {n})</Label>
                  <Input id={`line-rrate-${i}`} inputMode="decimal" value={l.recurringRate} disabled={disabled} onChange={(e) => set(i, { recurringRate: e.target.value })} />
                  {err(i, "recurringRate")}
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`line-est-${i}`}>Estimativa mensal (linha {n})</Label>
                  <Input id={`line-est-${i}`} inputMode="decimal" placeholder="0,00" value={l.estimatedMonthly} disabled={disabled} onChange={(e) => set(i, { estimatedMonthly: e.target.value })} />
                  {err(i, "estimatedMonthly")}
                </div>
              </>
            ) : null}
          </div>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...lines, emptyLine(defaultMonth)])}>
          <Plus /> Adicionar linha
        </Button>
      </div>
    </div>
  );
}
