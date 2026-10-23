"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MultiSelect } from "@/components/records/multi-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteReport, runReportAction, saveReport } from "@/lib/reports/actions";
import type { Option, ReportLookups } from "@/lib/reports/lookups";
import {
  BASES,
  CHARTS,
  CUSTOM_GROUP_BASES,
  MAX_FILTERS_UI,
  dimensionsFor,
  fieldDef,
  fieldsFor,
  metricsFor,
  opsForKind,
  reportSpecSchema,
  sumFieldsFor,
  type Base,
  type Chart,
  type CustomReportSpec,
  type FieldDef,
  type FilterOp,
  type MetricOp,
  type ReportResult,
} from "@/lib/reports/spec";
import { ReportChart } from "./report-chart";

const CHART_LABEL: Record<Chart, string> = {
  number: "Número",
  bar: "Barras",
  line: "Linha",
  funnel: "Funil",
  pie: "Pizza",
  table: "Tabela",
};

const OP_LABEL: Record<FilterOp, string> = {
  eq: "é igual a",
  in: "é um de",
  gte: "a partir de",
  lte: "até",
  between: "entre",
  is_null: "está vazio",
  not_null: "está preenchido",
};

type FilterRow = { id: number; field: string; op: FilterOp; values: string[] };

const selectCls =
  "h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Sel({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select id={id} aria-label={label} className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

/** Opções fixas do campo, ou o catálogo carregado para ele; vazio quando o valor é livre. */
function optionsFor(def: FieldDef, lookups: ReportLookups): Option[] {
  if (def.options) return def.options;
  return lookups.fields[def.key] ?? [];
}

/** Filtro sem valor é omitido (devolve null); o banco rejeitaria um valor vazio. */
function toSpecFilter(row: FilterRow, def: FieldDef) {
  if (row.op === "is_null" || row.op === "not_null") return { field: row.field, op: row.op };
  const conv = (v: string) => (def.type === "num" ? Number(v) : v);
  if (row.op === "between") {
    if (!row.values[0] || !row.values[1]) return null;
    return { field: row.field, op: row.op, value: [conv(row.values[0]), conv(row.values[1])] };
  }
  const vals = row.values.filter((v) => v !== "");
  if (vals.length === 0) return null;
  if (row.op === "in") return { field: row.field, op: row.op, value: vals.map(conv) };
  return { field: row.field, op: row.op, value: conv(vals[0]!) };
}

export type BuilderInitial = { id: string; name: string; spec: CustomReportSpec };

function initialFilters(spec: CustomReportSpec | undefined): FilterRow[] {
  return (spec?.filters ?? []).map((f, i) => {
    const v = f.value;
    const values = Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : [String(v)];
    return { id: i + 1, field: f.field, op: f.op, values };
  });
}

export function ReportBuilder({
  scopeSlug,
  companyId,
  lookups,
  initial,
}: {
  scopeSlug: string;
  /** Empresa do escopo; null em "Todas as empresas". */
  companyId: string | null;
  lookups: ReportLookups;
  initial?: BuilderInitial;
}) {
  const router = useRouter();
  const s = initial?.spec;
  const [name, setName] = useState(initial?.name ?? "");
  const [base, setBase] = useState<Base>(s?.base ?? "deals");
  const [op, setOp] = useState<MetricOp>(s?.metric.op ?? "count");
  const [metricField, setMetricField] = useState(s?.metric.field ?? "");
  const [groupBy, setGroupBy] = useState(s?.group_by ?? "");
  const [chart, setChart] = useState<Chart>(s?.chart ?? "bar");
  const [filters, setFilters] = useState<FilterRow[]>(() => initialFilters(s));
  const [periodField, setPeriodField] = useState(s?.period?.field ?? "");
  const [from, setFrom] = useState(s?.period?.from ?? "");
  const [to, setTo] = useState(s?.period?.to ?? "");
  const nextId = useRef((s?.filters?.length ?? 0) + 1);
  const [pending, startTransition] = useTransition();

  const metrics = metricsFor(base);
  const sumFields = sumFieldsFor(base);
  const dims = dimensionsFor(base);
  const fields = fieldsFor(base);
  const dateFields = fields.filter((f) => f.type === "ts" || f.type === "date");
  const customGroups = lookups.customGroups.filter((g) => g.base === base && CUSTOM_GROUP_BASES.includes(base));

  function changeBase(next: Base) {
    setBase(next);
    setOp("count");
    setMetricField("");
    setGroupBy("");
    setFilters([]);
    setPeriodField("");
    setFrom("");
    setTo("");
  }

  const needsField = op === "sum" || op === "avg";
  const effectiveField = metricField || sumFields[0]?.key || "";
  const spec = (() => {
    const out: Record<string, unknown> = {
      kind: "custom",
      base,
      metric: needsField ? { op, field: effectiveField } : { op },
      chart,
    };
    if (groupBy) out.group_by = groupBy;
    const fs = filters
      .map((row) => {
        const def = fieldDef(base, row.field);
        return def ? toSpecFilter(row, def) : null;
      })
      .filter((f) => f !== null);
    if (fs.length > 0) out.filters = fs;
    if (periodField && from && to) out.period = { field: periodField, from, to };
    return out;
  })();

  const parsed = reportSpecSchema.safeParse(spec);
  const specKey = JSON.stringify(spec);
  const [preview, setPreview] = useState<{ result?: ReportResult; error?: string; loading: boolean }>({
    loading: false,
  });
  const reqId = useRef(0);

  useEffect(() => {
    const check = reportSpecSchema.safeParse(JSON.parse(specKey));
    if (!check.success) return;
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setPreview((p) => ({ ...p, loading: true }));
      try {
        const res = await runReportAction(check.data, scopeSlug);
        if (id !== reqId.current) return;
        setPreview(res.ok ? { result: res.data, loading: false } : { error: res.error, loading: false });
      } catch {
        if (id === reqId.current) setPreview({ error: "Não foi possível carregar a pré-visualização.", loading: false });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [specKey, scopeSlug]);

  const specError = parsed.success ? null : (parsed.error.issues[0]?.message ?? "Revise os campos.");

  function updateFilter(id: number, patch: Partial<FilterRow>) {
    setFilters((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addFilter() {
    if (filters.length >= MAX_FILTERS_UI) return;
    const f = fields[0]!;
    setFilters((rows) => [...rows, { id: nextId.current++, field: f.key, op: opsForKind(f.type)[0]!, values: [] }]);
  }

  function save() {
    if (!parsed.success) return void toast.error(specError ?? "Revise os campos.");
    const valid = parsed.data;
    startTransition(async () => {
      const res = await saveReport({ id: initial?.id, name, companyId, spec: valid });
      if (!res.ok) return void toast.error(res.error);
      toast.success("Relatório salvo.");
      router.push(`/${scopeSlug}/relatorios`);
      router.refresh();
    });
  }
  function remove() {
    if (!initial) return;
    startTransition(async () => {
      const res = await deleteReport(initial.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Relatório excluído.");
      router.push(`/${scopeSlug}/relatorios`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="report-name">Nome</Label>
          <Input
            id="report-name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Receita por etapa"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rb-base">Base</Label>
          <Sel id="rb-base" label="Base" value={base} onChange={(v) => changeBase(v as Base)}>
            {BASES.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label}
              </option>
            ))}
          </Sel>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rb-metric">Métrica</Label>
          <div className="flex flex-wrap gap-2">
            <Sel
              id="rb-metric"
              label="Métrica"
              value={op}
              onChange={(v) => {
                setOp(v as MetricOp);
                setMetricField("");
              }}
            >
              {metrics.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Sel>
            {needsField ? (
              <Sel label="Campo da métrica" value={effectiveField} onChange={setMetricField}>
                {sumFields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </Sel>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rb-group">Agrupar por</Label>
          <Sel id="rb-group" label="Agrupar por" value={groupBy} onChange={setGroupBy}>
            <option value="">Sem agrupamento</option>
            {dims.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
            {customGroups.map((g) => (
              <option key={g.key} value={`custom:${g.key}`}>
                {g.label}
              </option>
            ))}
          </Sel>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rb-period">Período</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Sel id="rb-period" label="Campo do período" value={periodField} onChange={setPeriodField}>
              <option value="">Todo o período</option>
              {dateFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Sel>
            {periodField ? (
              <>
                <Input type="date" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
                <Input type="date" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
              </>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rb-chart">Gráfico</Label>
          <Sel id="rb-chart" label="Gráfico" value={chart} onChange={(v) => setChart(v as Chart)}>
            {CHARTS.map((c) => (
              <option key={c} value={c}>
                {CHART_LABEL[c]}
              </option>
            ))}
          </Sel>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Filtros</span>
            <Button type="button" size="sm" variant="outline" onClick={addFilter} disabled={filters.length >= MAX_FILTERS_UI}>
              Adicionar filtro
            </Button>
          </div>
          {filters.length >= MAX_FILTERS_UI ? (
            <p className="text-xs text-muted-foreground">Limite de {MAX_FILTERS_UI} filtros.</p>
          ) : null}
          {filters.map((row) => {
            const def = fieldDef(base, row.field);
            if (!def) return null;
            const ops = opsForKind(def.type);
            return (
              <div key={row.id} className="space-y-2 rounded-md border p-2" data-testid="filter-row">
                <div className="flex flex-wrap gap-2">
                  <Sel
                    label="Campo do filtro"
                    value={row.field}
                    onChange={(v) => {
                      const d = fieldDef(base, v)!;
                      updateFilter(row.id, { field: v, op: opsForKind(d.type)[0]!, values: [] });
                    }}
                  >
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </Sel>
                  <Sel label="Operador" value={row.op} onChange={(v) => updateFilter(row.id, { op: v as FilterOp, values: [] })}>
                    {ops.map((o) => (
                      <option key={o} value={o}>
                        {OP_LABEL[o]}
                      </option>
                    ))}
                  </Sel>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remover filtro"
                    onClick={() => setFilters((rows) => rows.filter((r) => r.id !== row.id))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <FilterValue
                  def={def}
                  row={row}
                  options={optionsFor(def, lookups)}
                  onChange={(values) => updateFilter(row.id, { values })}
                />
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <Button type="button" onClick={save} disabled={pending || !name.trim()}>
            Salvar
          </Button>
          {initial ? (
            <Button type="button" variant="outline" onClick={remove} disabled={pending}>
              Excluir
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-w-0 space-y-2 rounded-lg border p-4" aria-live="polite">
        <h2 className="text-sm font-medium text-muted-foreground">Pré-visualização</h2>
        {specError ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{specError}</p>
        ) : preview.error ? (
          <p role="alert" className="py-8 text-center text-sm text-destructive">
            {preview.error}
          </p>
        ) : preview.result ? (
          <div className={preview.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <ReportChart result={preview.result} chart={chart} title={name || "Relatório"} />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando</p>
        )}
      </div>
    </div>
  );
}

function FilterValue({
  def,
  row,
  options,
  onChange,
}: {
  def: FieldDef;
  row: FilterRow;
  options: Option[];
  onChange: (values: string[]) => void;
}) {
  if (row.op === "is_null" || row.op === "not_null") return null;
  if (row.op === "in" && options.length > 0) {
    return <MultiSelect label="Valores" options={options} value={row.values} onChange={onChange} />;
  }
  if (row.op === "in") {
    return (
      <Input
        aria-label="Valores separados por vírgula"
        placeholder="Valores separados por vírgula"
        defaultValue={row.values.join(",")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }
  const kind = def.type === "num" ? "number" : def.type === "ts" || def.type === "date" ? "date" : "text";
  if (row.op === "eq" && options.length > 0) {
    return (
      <Sel label="Valor" value={row.values[0] ?? ""} onChange={(v) => onChange(v ? [v] : [])}>
        <option value="">Escolha</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Sel>
    );
  }
  if (row.op === "between") {
    return (
      <div className="flex gap-2">
        <Input type={kind} aria-label="De" value={row.values[0] ?? ""} onChange={(e) => onChange([e.target.value, row.values[1] ?? ""])} />
        <Input type={kind} aria-label="Até" value={row.values[1] ?? ""} onChange={(e) => onChange([row.values[0] ?? "", e.target.value])} />
      </div>
    );
  }
  return (
    <Input
      type={kind}
      aria-label="Valor"
      value={row.values[0] ?? ""}
      onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
    />
  );
}
