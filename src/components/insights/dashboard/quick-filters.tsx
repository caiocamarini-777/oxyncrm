"use client";

import { Calendar, ChevronDown, GitBranch, User, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PERIOD_LABEL, PERIOD_MENU } from "@/lib/insights/meta";
import { formatDay, periodBounds } from "@/lib/insights/period";
import type { CatalogOption, PeriodKey, QuickFilters } from "@/lib/insights/types";
import { cn } from "@/lib/utils";
import { Picker } from "../picker";

type Props = {
  value: QuickFilters;
  onChange: (q: QuickFilters) => void;
  users: CatalogOption[];
  pipelines: CatalogOption[];
};

/** Filtros rápidos do painel (Período, Usuário, Funil), como no Pipedrive. Guardados por usuário. */
export function QuickFiltersBar({ value, onChange, users, pipelines }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<{ from: string; to: string }>({
    from: value.period?.period === "custom" ? (value.period.from ?? "") : "",
    to: value.period?.period === "custom" ? (value.period.to ?? "") : "",
  });
  const p = value.period;
  const range = p ? (p.period === "custom" ? { from: p.from ?? null, to: p.to ?? null } : periodBounds(p.period)) : null;
  const periodText = p ? (p.period === "custom" ? `${formatDay(range?.from)} - ${formatDay(range?.to)}` : PERIOD_LABEL[p.period]) : "Período";

  const pick = (period: PeriodKey) => {
    if (period === "custom") return;
    onChange({ ...value, period: { period } });
    setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 print:hidden">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn(p && "border-primary text-primary")}>
            <Calendar className="size-4" /> {periodText} <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2">
          <div className="grid grid-cols-2 gap-1">
            {PERIOD_MENU.filter((x) => x !== "custom").map((x) => (
              <Button key={x} variant={p?.period === x ? "secondary" : "ghost"} size="sm" className="justify-start" onClick={() => pick(x)}>
                {PERIOD_LABEL[x]}
              </Button>
            ))}
          </div>
          <div className="mt-2 space-y-1 border-t pt-2">
            <p className="text-xs text-muted-foreground">Personalizado</p>
            <div className="flex items-center gap-1">
              <Input type="date" className="h-8 text-xs" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="De" />
              <Input type="date" className="h-8 text-xs" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="Até" />
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" size="sm" disabled={!p} onClick={() => (onChange({ ...value, period: null }), setOpen(false))}>
                Limpar
              </Button>
              <Button
                size="sm"
                disabled={!custom.from || !custom.to || custom.from > custom.to}
                onClick={() => (onChange({ ...value, period: { period: "custom", ...custom } }), setOpen(false))}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Picker
        multi
        options={users.map((u) => ({ id: u.id, label: u.label, group: u.active === false ? "Usuários desativados" : "Usuários ativos", inactive: u.active === false }))}
        value={value.userIds}
        ariaLabel="Usuário"
        triggerLabel={value.userIds.length ? `Usuário (${value.userIds.length})` : "Usuário"}
        className={cn(value.userIds.length && "border-primary text-primary")}
        align="end"
        icon={
          <>
            <User className="size-4" /> {value.userIds.length ? `Usuário (${value.userIds.length})` : "Usuário"} <ChevronDown className="size-3.5 opacity-60" />
          </>
        }
        onChange={(ids) => onChange({ ...value, userIds: ids })}
      />
      <Picker
        options={pipelines.map((x) => ({ id: x.id, label: x.label, inactive: x.active === false }))}
        value={value.pipelineId ? [value.pipelineId] : []}
        ariaLabel="Funil de vendas"
        align="end"
        className={cn(value.pipelineId && "border-primary text-primary")}
        icon={
          <>
            <GitBranch className="size-4" /> {pipelines.find((x) => x.id === value.pipelineId)?.label ?? "Funil de vendas"}{" "}
            <ChevronDown className="size-3.5 opacity-60" />
          </>
        }
        onChange={(ids) => onChange({ ...value, pipelineId: ids[0] === value.pipelineId ? null : (ids[0] ?? null) })}
      />
      {p || value.userIds.length || value.pipelineId ? (
        <Button variant="ghost" size="icon" className="size-8" aria-label="Limpar filtros rápidos" onClick={() => onChange({ period: null, userIds: [], pipelineId: null })}>
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
