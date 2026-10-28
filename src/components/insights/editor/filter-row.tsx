"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { searchRecordsAction } from "@/lib/insights/actions";
import { filterGroups, isDateField, optionsFor, resolveField, searchKind } from "@/lib/insights/catalog";
import { filterOperator, filterValues, MULTI_OPS, newFilter, NO_VALUE_OPS } from "@/lib/insights/filters";
import { DATA_TYPE_LABEL, NUMBER_OPERATOR_LABEL, OPERATOR_LABEL, PERIOD_LABEL, PERIOD_MENU } from "@/lib/insights/meta";
import { customRange, formatDay, periodBounds } from "@/lib/insights/period";
import type { Catalog, InsightDefinition, InsightFilter, Operator, PeriodKey } from "@/lib/insights/types";
import { Picker, type PickerOption } from "../picker";

type Props = {
  catalog: Catalog;
  def: InsightDefinition;
  companyId: string;
  filter: InsightFilter;
  onChange: (f: InsightFilter) => void;
  onRemove: () => void;
  readOnly?: boolean;
};

const PERIOD_MODE = "__period";

/** Uma linha de filtro: ENTIDADE › campo › operador › valor (como no Pipedrive). */
export function FilterRow({ catalog, def, companyId, filter, onChange, onRemove, readOnly }: Props) {
  const groups = useMemo(() => filterGroups(catalog, def.data_type, def.report_type), [catalog, def.data_type, def.report_type]);
  const resolved = resolveField(catalog, def.data_type, filter.filter, def.report_type);
  const group = groups.find((g) => g.prefix !== "" && filter.filter.startsWith(g.prefix)) ?? groups[0]!;
  const field = resolved?.field;
  const date = isDateField(field);
  const op = filterOperator(filter);
  const values = filterValues(filter);
  const kind = field ? searchKind(field) : null;
  const opts = field ? optionsFor(catalog, field) : null;
  const search = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      if (!kind) return [];
      const r = await searchRecordsAction(companyId, kind, q);
      return r.ok ? r.data : [];
    },
    [companyId, kind],
  );

  const setOperand = (name: Operator, value: unknown) => onChange({ ...filter, period: null, operands: [{ name, defaultValue: value }] });

  function pickEntity(prefix: string) {
    const g = groups.find((x) => x.prefix === prefix);
    const first = g?.fields[0];
    if (first) onChange(newFilter(first, first.id));
  }

  function pickField(id: string) {
    const f = group.fields.find((x) => x.id === id);
    if (f) onChange(newFilter(f, id));
  }

  function pickOperator(next: string) {
    if (next === PERIOD_MODE) {
      onChange({ ...filter, period: "month", operands: [] });
      return;
    }
    const o = next as Operator;
    const v = NO_VALUE_OPS.includes(o) ? true : MULTI_OPS.includes(o) ? values : (values[0] ?? null);
    setOperand(o, v);
  }

  const opValue = date && filter.period ? PERIOD_MODE : (op ?? "");
  const opList: { key: string; label: string }[] = date
    ? [{ key: PERIOD_MODE, label: "é" }, ...(field?.operators ?? []).map((o) => ({ key: o, label: OPERATOR_LABEL[o] }))]
    : (field?.operators ?? []).map((o) => ({
        key: o,
        label: (field?.type === "NUMERICAL" || field?.type === "MONETARY" ? NUMBER_OPERATOR_LABEL[o] : undefined) ?? OPERATOR_LABEL[o],
      }));

  let valueEditor: React.ReactNode = null;
  if (field && date && filter.period) {
    const range = filter.period === "custom" ? customRange(filter) : periodBounds(filter.period);
    valueEditor = (
      <>
        <Select
          value={filter.period}
          onValueChange={(p) =>
            onChange({
              ...filter,
              period: p as PeriodKey,
              operands:
                p === "custom"
                  ? [
                      { name: "isMoreThan", defaultValue: range.from ?? null },
                      { name: "isLessThan", defaultValue: range.to ?? null },
                    ]
                  : [],
            })
          }
          disabled={readOnly}
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_MENU.map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filter.period === "custom" ? (
          <>
            <Input
              type="date"
              className="h-8 w-36"
              value={range.from ?? ""}
              aria-label="De"
              disabled={readOnly}
              onChange={(e) =>
                onChange({ ...filter, operands: [{ name: "isMoreThan", defaultValue: e.target.value }, { name: "isLessThan", defaultValue: range.to ?? null }] })
              }
            />
            <span className="text-muted-foreground">-</span>
            <Input
              type="date"
              className="h-8 w-36"
              value={range.to ?? ""}
              aria-label="Até"
              disabled={readOnly}
              onChange={(e) =>
                onChange({ ...filter, operands: [{ name: "isMoreThan", defaultValue: range.from ?? null }, { name: "isLessThan", defaultValue: e.target.value }] })
              }
            />
          </>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatDay(range.from)} - {formatDay(range.to)}
          </span>
        )}
      </>
    );
  } else if (field && op && !NO_VALUE_OPS.includes(op)) {
    if (date) {
      valueEditor = (
        <Input type="date" className="h-8 w-40" value={values[0] ?? ""} disabled={readOnly} aria-label="Data" onChange={(e) => setOperand(op, e.target.value)} />
      );
    } else if (opts || kind) {
      const multi = MULTI_OPS.includes(op);
      valueEditor = (
        <Picker
          options={opts?.map((o) => ({ id: o.id, label: o.label, inactive: o.active === false })) ?? undefined}
          search={kind ? search : undefined}
          value={values}
          multi={multi}
          ariaLabel="Valor"
          onChange={(ids) => setOperand(op, multi ? ids : (ids[0] ?? null))}
        />
      );
    } else if (field.type === "NUMERICAL" || field.type === "MONETARY") {
      valueEditor = (
        <Input
          type="number"
          className="h-8 w-32"
          value={values[0] ?? ""}
          disabled={readOnly}
          aria-label="Valor"
          onChange={(e) => setOperand(op, e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    } else {
      valueEditor = (
        <Input className="h-8 w-48" value={values[0] ?? ""} disabled={readOnly} aria-label="Valor" onChange={(e) => setOperand(op, e.target.value)} />
      );
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="size-2 rounded-full border border-muted-foreground/50" aria-hidden />
      <Select value={group.prefix || "_"} onValueChange={(v) => pickEntity(v === "_" ? "" : v)} disabled={readOnly}>
        <SelectTrigger size="sm" className="w-36 uppercase" aria-label="Entidade">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groups.map((g) => (
            <SelectItem key={g.prefix || "_"} value={g.prefix || "_"} className="uppercase">
              {DATA_TYPE_LABEL[g.entity]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Picker
        options={group.fields.map((f) => ({ id: f.id, label: f.name, group: f.custom ? "Campos personalizados" : `Campos de ${DATA_TYPE_LABEL[group.entity].toLowerCase()}` }))}
        value={field ? [filter.filter] : []}
        placeholder="Campo"
        ariaLabel="Campo"
        onChange={(ids) => ids[0] && pickField(ids[0])}
      />
      {field ? (
        <Select value={opValue} onValueChange={pickOperator} disabled={readOnly}>
          <SelectTrigger size="sm" className="w-auto min-w-20" aria-label="Operador">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opList.map((o) => (
              <SelectItem key={o.key} value={o.key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs text-destructive">Campo indisponível</span>
      )}
      {valueEditor}
      {!readOnly ? (
        <Button variant="ghost" size="icon" className="size-7" onClick={onRemove} aria-label="Remover filtro">
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
