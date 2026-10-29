"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  HORIZONS,
  toFinanceSearchParams,
  type FinanceFilters,
  type Nature,
  type Status,
} from "@/lib/finance/filters";

type Option = { id: string; name: string };
export type FilterLookups = {
  accounts: Option[];
  serviceCategories: Option[];
  expenseCategories: Option[];
  clients: Option[];
};
/** Quais controles a tela usa (as abas não precisam de todos). */
export type FilterControl =
  | "period"
  | "horizon"
  | "clients"
  | "services"
  | "expenses"
  | "natures"
  | "accounts"
  | "statuses"
  | "renewals"
  | "estimated";

const NATURE_OPTIONS: { id: Nature; name: string }[] = [
  { id: "fixed", name: "Fixa" },
  { id: "variable", name: "Variável" },
  { id: "non_recurring", name: "Não recorrente" },
];
const STATUS_OPTIONS: { id: Status; name: string }[] = [
  { id: "open", name: "Em aberto" },
  { id: "settled", name: "Liquidado" },
  { id: "cancelled", name: "Cancelado" },
];

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1">
          {label}
          {value.length > 0 ? ` (${value.length})` : ""}
          <ChevronDown className="size-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-72 w-64 overflow-y-auto p-2">
        {options.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground">Nada para filtrar.</p>
        ) : (
          options.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
              <input
                type="checkbox"
                checked={value.includes(o.id)}
                onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))}
              />
              {o.name}
            </label>
          ))
        )}
        {value.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="mt-1 w-full" onClick={() => onChange([])}>
            Limpar
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** Barra de filtros: escreve na URL com router.replace (a página é renderizada de novo no servidor). */
export function FinanceFilterBar({
  filters,
  lookups,
  today,
  controls,
}: {
  filters: FinanceFilters;
  lookups: FilterLookups;
  today: string;
  controls: FilterControl[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const has = (c: FilterControl) => controls.includes(c);

  function update(patch: Partial<FinanceFilters>) {
    const qs = toFinanceSearchParams({ ...filters, ...patch }, today).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filtros">
      {has("period") ? (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fin-from" className="text-xs text-muted-foreground">De</Label>
            <Input id="fin-from" type="date" className="h-8 w-40" value={filters.from} onChange={(e) => e.target.value && update({ from: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fin-to" className="text-xs text-muted-foreground">Até</Label>
            <Input id="fin-to" type="date" className="h-8 w-40" value={filters.to} onChange={(e) => e.target.value && update({ to: e.target.value })} />
          </div>
        </>
      ) : null}
      {has("horizon") ? (
        <div className="flex flex-col gap-1">
          <Label htmlFor="fin-horizon" className="text-xs text-muted-foreground">Horizonte</Label>
          <select
            id="fin-horizon"
            className="h-8 rounded-lg border bg-background px-2 text-sm"
            value={filters.horizon}
            onChange={(e) => update({ horizon: Number(e.target.value) as FinanceFilters["horizon"] })}
          >
            {HORIZONS.map((h) => (
              <option key={h} value={h}>{h} meses</option>
            ))}
          </select>
        </div>
      ) : null}
      {has("clients") ? <MultiSelect label="Clientes" options={lookups.clients} value={filters.clients} onChange={(v) => update({ clients: v })} /> : null}
      {has("services") ? <MultiSelect label="Serviços" options={lookups.serviceCategories} value={filters.serviceCategories} onChange={(v) => update({ serviceCategories: v })} /> : null}
      {has("expenses") ? <MultiSelect label="Categorias de despesa" options={lookups.expenseCategories} value={filters.expenseCategories} onChange={(v) => update({ expenseCategories: v })} /> : null}
      {has("natures") ? <MultiSelect label="Natureza" options={NATURE_OPTIONS} value={filters.natures} onChange={(v) => update({ natures: v as Nature[] })} /> : null}
      {has("accounts") ? <MultiSelect label="Contas" options={lookups.accounts} value={filters.accounts} onChange={(v) => update({ accounts: v })} /> : null}
      {has("statuses") ? <MultiSelect label="Situação" options={STATUS_OPTIONS} value={filters.statuses} onChange={(v) => update({ statuses: v as Status[] })} /> : null}
      {has("renewals") ? (
        <div className="flex items-center gap-2">
          <Switch id="fin-renewals" size="sm" checked={filters.includePendingRenewals} onCheckedChange={(v) => update({ includePendingRenewals: v })} />
          <Label htmlFor="fin-renewals" className="text-sm">Incluir renovações pendentes</Label>
        </div>
      ) : null}
      {has("estimated") ? (
        <div className="flex items-center gap-2">
          <Switch id="fin-estimated" size="sm" checked={filters.includeEstimatedCommissions} onCheckedChange={(v) => update({ includeEstimatedCommissions: v })} />
          <Label htmlFor="fin-estimated" className="text-sm">Incluir comissões estimadas</Label>
        </div>
      ) : null}
    </div>
  );
}
