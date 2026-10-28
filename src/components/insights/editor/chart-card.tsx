"use client";

import { Calendar, ChartBar, ChartColumn, ChartPie, Download, Funnel, Hash, Loader2, Settings, Table2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fieldsWithRole, isDateField, resolveField } from "@/lib/insights/catalog";
import { pointColors, segmentColorField, shapeChart } from "@/lib/insights/chart-shape";
import { allowedCharts } from "@/lib/insights/definition";
import { CHART_LABEL, CHART_SIZES, INTERVAL_LABEL, SORT_OPTIONS, type SortKey } from "@/lib/insights/meta";
import type { ColorContext } from "@/lib/insights/palette";
import type { Catalog, ChartType, InsightDefinition, InsightResult, Interval, Overrides } from "@/lib/insights/types";
import { INTERVALS } from "@/lib/insights/types";
import { ChartColorsDialog, type ColorsSave } from "../chart/chart-colors-dialog";
import { EmptyChart } from "../chart/empty-chart";
import { InsightChart, type PointClick } from "../chart/insight-chart";
import { Picker } from "../picker";
import { exportChartCsv, exportPng } from "./export";

const ICON: Record<ChartType, typeof ChartColumn> = {
  column: ChartColumn,
  bar: ChartBar,
  pie: ChartPie,
  scorecard: Hash,
  table: Table2,
  funnel: Funnel,
};

type Props = {
  catalog: Catalog;
  def: InsightDefinition;
  result: InsightResult | null;
  loading: boolean;
  error: string | null;
  colors: ColorContext;
  savedColors: string[];
  canEdit: boolean;
  canSetCompanyColor: boolean;
  compare: Overrides["compare"];
  onCompare: (c: Overrides["compare"]) => void;
  onChange: (def: InsightDefinition) => void;
  onColorsSave: (s: ColorsSave, field: string) => void | Promise<void>;
  onPointClick: (p: PointClick) => void;
  name: string;
};

export function ChartCard(props: Props) {
  const { catalog, def, result, loading, error, colors, canEdit, compare, onCompare, onChange } = props;
  const [sort, setSort] = useState<SortKey>("default");
  const [page, setPage] = useState(0);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [customCmp, setCustomCmp] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const chartRef = useRef<HTMLDivElement>(null);
  const P = def.parameters;
  const charts = allowedCharts(def.data_type, def.report_type);
  const set = (patch: Partial<InsightDefinition["parameters"]>) => onChange({ ...def, parameters: { ...P, ...patch } });

  const groupFields = fieldsWithRole(catalog, def.data_type, def.report_type, "g");
  const segFields = fieldsWithRole(catalog, def.data_type, def.report_type, "s");
  const measureFields = fieldsWithRole(catalog, def.data_type, def.report_type, "m");
  const groupField = P.group_by ? resolveField(catalog, def.data_type, P.group_by.filter, def.report_type)?.field : null;
  const isFunnel = def.report_type === "funnel_conversion";
  const fixedSegment = def.report_type === "conversion_overall" || (def.data_type === "leads" && def.report_type === "conversion") || isFunnel;
  const showAxes = def.chart_type !== "scorecard" && !isFunnel;
  const measureLabel = P.measure_by === "count" ? (result?.measure.label ?? "Contagem") : (measureFields.find((m) => m.id === P.measure_by)?.name ?? P.measure_by);

  const shaped = useMemo(() => (result ? shapeChart(result, def, colors) : null), [result, def, colors]);
  const segments = useMemo(() => {
    if (!result || !shaped) return [];
    if (def.chart_type === "pie") {
      const pc = pointColors(result, colors);
      return result.x.map((p) => ({ key: p.key, label: p.label, color: pc[p.key]! }));
    }
    return shaped.series;
  }, [result, shaped, def, colors]);
  const colorField = !result ? "" : def.chart_type === "pie" ? (result.x_field?.id ?? "") : shaped?.segmented ? segmentColorField(result, def) : "";

  const stages = catalog.options.stages ?? [];
  const pipelines = catalog.options.pipelines ?? [];

  return (
    <section className="rounded-lg border bg-card" aria-label="Gráfico">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <ToggleGroup
          type="single"
          value={def.chart_type}
          onValueChange={(v) => v && onChange({ ...def, chart_type: v as ChartType })}
          aria-label="Tipo de gráfico"
          size="sm"
        >
          {charts.map((c) => {
            const Icon = ICON[c];
            return (
              <ToggleGroupItem key={c} value={c} aria-label={CHART_LABEL[c]} title={CHART_LABEL[c]}>
                <Icon className="size-4" />
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Carregando" /> : null}
        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Calendar className="size-4" /> {compare ? (compare.kind === "previous" ? "Período anterior" : "Comparando") : "Comparar"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => onCompare({ kind: "previous" })}>Período anterior</DropdownMenuItem>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Período personalizado</DropdownMenuLabel>
              <div className="flex items-center gap-1 px-2 pb-2" onKeyDown={(e) => e.stopPropagation()}>
                <Input type="date" className="h-7 text-xs" value={customCmp.from} onChange={(e) => setCustomCmp((c) => ({ ...c, from: e.target.value }))} aria-label="Comparar de" />
                <Input type="date" className="h-7 text-xs" value={customCmp.to} onChange={(e) => setCustomCmp((c) => ({ ...c, to: e.target.value }))} aria-label="Comparar até" />
              </div>
              <DropdownMenuItem disabled={!customCmp.from || !customCmp.to} onSelect={() => onCompare({ kind: "custom", ...customCmp })}>
                Comparar com o período
              </DropdownMenuItem>
              {compare ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onCompare(null)}>Sem comparação</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!result}>
                <Download className="size-4" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => result && shaped && exportChartCsv(props.name, result, shaped)}>Tabela (CSV)</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => chartRef.current && exportPng(chartRef.current, props.name)}>Imagem (PNG)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-8" aria-label="Configurações do gráfico">
                <Settings className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {def.chart_type === "column" || def.chart_type === "bar" ? (
                <>
                  <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">Colunas por página</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={String(P.chart_size_amount ?? 12)}
                    onValueChange={(v) => {
                      setPage(0);
                      set({ chart_size_amount: Number(v) });
                    }}
                  >
                    {CHART_SIZES.map((n) => (
                      <DropdownMenuRadioItem key={n} value={String(n)} disabled={!canEdit}>
                        {n}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={!!P.is_cumulative} disabled={!canEdit} onCheckedChange={(c) => set({ is_cumulative: c === true })}>
                    Valores acumulados
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem disabled={!canEdit || !result} onSelect={() => setColorsOpen(true)}>
                Personalizar cores do gráfico
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="space-y-3 p-3">
        {showAxes ? (
          <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground">Ordenar por</span>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger size="sm" className="w-auto" aria-label="Ordenar por">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!fixedSegment && def.chart_type !== "pie" ? (
              <>
                <span className="ml-2 text-muted-foreground">Segmentar por</span>
                <Picker
                  options={segFields.filter((f) => f.id !== P.group_by?.filter).map((f) => ({ id: f.id, label: f.name, group: f.custom ? "Campos personalizados" : undefined }))}
                  value={P.segment_by && P.segment_by !== "none" ? [P.segment_by] : []}
                  placeholder="Nenhum"
                  ariaLabel="Segmentar por"
                  onChange={(ids) => set({ segment_by: ids[0] ?? null })}
                />
                {P.segment_by && P.segment_by !== "none" ? (
                  <Button variant="ghost" size="icon" className="size-7" aria-label="Tirar segmentação" onClick={() => set({ segment_by: null })}>
                    <X className="size-4" />
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {isFunnel ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Etapas</span>
            <Picker
              multi
              options={stages.map((s) => ({ id: s.id, label: s.label, group: pipelines.find((p) => p.id === s.pipeline_id)?.label }))}
              value={P.stages ?? []}
              placeholder="Todas as etapas do funil"
              ariaLabel="Etapas"
              onChange={(ids) => set({ stages: ids })}
            />
          </div>
        ) : null}

        <div className="flex gap-2">
          {showAxes || def.chart_type === "scorecard" ? (
            <div className="flex w-6 shrink-0 flex-col items-center justify-center">
              <Picker
                options={[
                  { id: "count", label: result?.measure.id === "count" ? result.measure.label : "Contagem" },
                  ...measureFields.map((f) => ({ id: f.id, label: f.name, group: f.custom ? "Campos personalizados" : "Campos" })),
                ]}
                value={[P.measure_by]}
                ariaLabel="Medir por"
                triggerLabel={measureLabel}
                variant="ghost"
                className="origin-center -rotate-90 whitespace-nowrap text-xs"
                onChange={(ids) => ids[0] && set({ measure_by: ids[0], measure_by_aggregation: null })}
              />
            </div>
          ) : null}
          <div ref={chartRef} className="min-w-0 flex-1 bg-card">
            {error ? (
              <EmptyChart message={error} />
            ) : result ? (
              <InsightChart def={def} result={result} colors={colors} sort={sort} page={page} onPage={setPage} onPointClick={props.onPointClick} />
            ) : (
              <div className="flex h-72 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Carregando" />
              </div>
            )}
          </div>
        </div>

        {showAxes ? (
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-muted-foreground">Ver por</span>
            <Picker
              options={groupFields.map((f) => ({ id: f.id, label: f.name, group: f.custom ? "Campos personalizados" : undefined }))}
              value={P.group_by ? [P.group_by.filter] : []}
              ariaLabel="Ver por"
              onChange={(ids) => {
                const f = groupFields.find((x) => x.id === ids[0]);
                if (f) set({ group_by: { filter: f.id, interval: isDateField(f) ? "month" : false } });
              }}
            />
            {isDateField(groupField) ? (
              <Select value={(P.group_by?.interval as string) || "month"} onValueChange={(v) => set({ group_by: { filter: P.group_by!.filter, interval: v as Interval } })}>
                <SelectTrigger size="sm" className="w-auto" aria-label="Intervalo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => (
                    <SelectItem key={i} value={i}>
                      {INTERVAL_LABEL[i]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}
      </div>

      {colorsOpen && result ? (
        <ChartColorsDialog
          open={colorsOpen}
          onOpenChange={setColorsOpen}
          segments={segments}
          saved={props.savedColors}
          canSetCompany={props.canSetCompanyColor && colorField !== ""}
          onSave={(x) => props.onColorsSave(x, colorField)}
        />
      ) : null}
    </section>
  );
}
