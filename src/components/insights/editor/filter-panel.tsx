"use client";

import { ChevronDown, ChevronUp, ListFilter, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { fieldsWithRole } from "@/lib/insights/catalog";
import { chipText, isComplete, newFilter } from "@/lib/insights/filters";
import type { Catalog, InsightDefinition, InsightFilter } from "@/lib/insights/types";
import { FilterRow } from "./filter-row";

type Props = {
  catalog: Catalog;
  def: InsightDefinition;
  companyId: string;
  onChange: (filters: InsightFilter[]) => void;
  readOnly?: boolean;
};

export function FilterPanel({ catalog, def, companyId, onChange, readOnly }: Props) {
  const [open, setOpen] = useState(true);
  const filters = def.parameters.filter_by;
  const done = filters.filter(isComplete);
  const summary = done.map((f) => chipText(catalog, def, f)).filter(Boolean) as string[];

  function add() {
    const fields = fieldsWithRole(catalog, def.data_type, def.report_type, "f");
    const first = fields.find((f) => f.type === "DATE_TIME") ?? fields[0];
    if (first) onChange([...filters, newFilter(first)]);
  }

  return (
    <section className="rounded-lg border bg-card" aria-label="Filtros">
      <header className="flex items-center gap-2 px-3 py-2">
        <ListFilter className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">
          {done.length === 1 ? "1 filtro aplicado" : `${done.length} filtros aplicados`}
        </span>
        <span className="ml-auto truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {summary.join(" · ")}
        </span>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => setOpen((o) => !o)} aria-label={open ? "Recolher filtros" : "Mostrar filtros"}>
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>
      </header>
      {open ? (
        <div className="space-y-2 border-t px-3 py-3">
          {filters.map((f, i) => (
            <FilterRow
              key={i}
              catalog={catalog}
              def={def}
              companyId={companyId}
              filter={f}
              readOnly={readOnly}
              onChange={(nf) => onChange(filters.map((x, j) => (j === i ? nf : x)))}
              onRemove={() => onChange(filters.filter((_, j) => j !== i))}
            />
          ))}
          {!readOnly ? (
            <Button variant="ghost" size="sm" className="text-primary" onClick={add}>
              <Plus className="size-4" /> Adicionar filtro
            </Button>
          ) : filters.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem filtros.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
