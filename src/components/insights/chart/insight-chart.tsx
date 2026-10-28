"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { isEmptyResult, pointColors, shapeChart, VALUE_KEY, type Series } from "@/lib/insights/chart-shape";
import { formatMeasure, formatPercent } from "@/lib/insights/format";
import type { SortKey } from "@/lib/insights/meta";
import type { ColorContext } from "@/lib/insights/palette";
import type { InsightDefinition, InsightResult } from "@/lib/insights/types";
import { EmptyChart } from "./empty-chart";
import { FunnelChart } from "./funnel-chart";
import { PivotTable } from "./pivot-table";
import { Scorecard } from "./scorecard";

export type PointClick = { x?: string; s?: string };

type Props = {
  def: InsightDefinition;
  result: InsightResult;
  colors: ColorContext;
  /** widget do painel: ocupa a altura do cartão e a legenda vai para baixo */
  compact?: boolean;
  sort?: SortKey;
  page?: number;
  onPage?: (page: number) => void;
  onPointClick?: (p: PointClick) => void;
};

const tick = { fontSize: 11, fill: "currentColor" };

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Legend({ series, vertical }: { series: Series[]; vertical: boolean }) {
  return (
    <ul className={vertical ? "flex w-40 shrink-0 flex-col gap-1.5 text-xs" : "flex flex-wrap gap-x-3 gap-y-1 text-xs"}>
      {series.map((s) => (
        <li key={s.key} className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
          <span className="truncate" title={s.label}>
            {s.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function InsightChart({ def, result, colors, compact = false, sort = "default", page = 0, onPage, onPointClick }: Props) {
  const pageSize = def.chart_type === "column" || def.chart_type === "bar" ? (def.parameters.chart_size_amount ?? (compact ? null : 12)) : null;
  const shaped = useMemo(
    () => shapeChart(result, def, colors, { sort, page, pageSize }),
    [result, def, colors, sort, page, pageSize],
  );

  if (isEmptyResult(result, def.chart_type)) return <EmptyChart />;
  if (def.chart_type === "scorecard") return <Scorecard result={result} compact={compact} />;
  if (def.chart_type === "table") return <PivotTable result={result} shaped={shapeChart(result, def, colors)} compact={compact} />;
  if (def.chart_type === "funnel") return <FunnelChart result={result} colors={colors} compact={compact} />;

  const mtype = result.measure.type;
  const fmt = (v: number) => formatMeasure(v, mtype, { compact: true });

  if (def.chart_type === "pie") {
    const pc = pointColors(result, colors);
    const total = result.x.reduce((a, _p, i) => a + Number(result.totals?.[i] ?? result.values[i]?.[0] ?? 0), 0);
    const data = result.x.map((p, i) => ({ key: p.key, label: p.label, value: Number(result.totals?.[i] ?? result.values[i]?.[0] ?? 0) }));
    const series: Series[] = data.map((d) => ({ key: d.key, label: d.label, color: pc[d.key]! }));
    return (
      <div className={compact ? "flex h-full min-h-0 flex-col gap-2" : "flex gap-4"}>
        <div className={compact ? "min-h-0 flex-1" : "h-80 flex-1"}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 240 }}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius="0%"
                outerRadius="80%"
                stroke="var(--background)"
                strokeWidth={2}
                isAnimationActive={false}
                label={({ value }) => `${fmt(Number(value))} (${formatPercent(total ? Number(value) / total : 0)})`}
                labelLine={false}
                onClick={(d) => onPointClick?.({ x: (d as { key?: string }).key })}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={pc[d.key]} className={onPointClick ? "cursor-pointer" : undefined} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatMeasure(Number(v), mtype)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <Legend series={series} vertical={!compact} />
      </div>
    );
  }

  const horizontal = def.chart_type === "bar";
  const segmented = shaped.segmented;
  const cmp = result.compare;
  const data = shaped.rows.map((r) => {
    const i = result.x.findIndex((p) => p.key === r.key);
    return {
      key: r.key,
      label: r.label,
      __total: r.total,
      ...(cmp ? { __compare: Number(cmp.totals?.[i] ?? 0) } : {}),
      ...r.values,
    };
  });
  const lastKey = shaped.series[shaped.series.length - 1]?.key;
  const barHeight = horizontal ? Math.max(compact ? 0 : 320, data.length * 30 + 40) : undefined;
  const click = (series: string) => (entry: unknown) => {
    const key = (entry as { payload?: { key?: string }; key?: string })?.payload?.key ?? (entry as { key?: string })?.key;
    onPointClick?.({ x: key, ...(segmented && series !== VALUE_KEY ? { s: series } : {}) });
  };

  const chart = (
    <ResponsiveContainer width="100%" height={compact && !horizontal ? "100%" : (barHeight ?? 320)} initialDimension={{ width: 480, height: 280 }}>
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 18, right: horizontal ? 48 : 8, bottom: 0, left: 0 }}
        barCategoryGap={horizontal ? 6 : "18%"}
      >
        <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={tick} tickFormatter={fmt} allowDecimals={false} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="label"
              tick={tick}
              width={compact ? 96 : 150}
              interval={0}
              tickFormatter={(v: string) => truncate(v, compact ? 14 : 22)}
              axisLine={false}
              tickLine={false}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey="label"
              tick={tick}
              interval={data.length > 14 ? "preserveStartEnd" : 0}
              tickFormatter={(v: string) => truncate(v, data.length > 6 ? 12 : 22)}
              axisLine={false}
              tickLine={false}
            />
            <YAxis tick={tick} width={compact ? 44 : 64} tickFormatter={fmt} allowDecimals={false} axisLine={false} tickLine={false} />
          </>
        )}
        <Tooltip
          cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
          formatter={(v, name) => [formatMeasure(Number(v), mtype), name === "__compare" ? "Período comparado" : name]}
          labelFormatter={(l) => String(l)}
        />
        {cmp ? <Bar dataKey="__compare" name="Período comparado" fill="currentColor" fillOpacity={0.18} radius={4} isAnimationActive={false} /> : null}
        {shaped.series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId={segmented ? "s" : undefined}
            fill={s.color}
            stroke="var(--background)"
            strokeWidth={segmented ? 1 : 0}
            radius={!segmented || s.key === lastKey ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
            isAnimationActive={false}
            className={onPointClick ? "cursor-pointer" : undefined}
            onClick={click(s.key)}
          >
            {s.key === lastKey ? (
              <LabelList
                dataKey="__total"
                position={horizontal ? "right" : "top"}
                className="fill-foreground"
                fontSize={11}
                formatter={(v: unknown) => fmt(Number(v))}
              />
            ) : null}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );

  const pager =
    shaped.pageCount > 1 && onPage ? (
      <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
        <Button variant="ghost" size="icon" className="size-6" disabled={page <= 0} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="size-4" />
        </Button>
        {page + 1} / {shaped.pageCount}
        <Button variant="ghost" size="icon" className="size-6" disabled={page >= shaped.pageCount - 1} onClick={() => onPage(page + 1)} aria-label="Próxima página">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    ) : null;

  if (compact) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-1">
        <div className={horizontal ? "min-h-0 flex-1 overflow-y-auto" : "min-h-0 flex-1"}>{chart}</div>
        {segmented ? <Legend series={shaped.series} vertical={false} /> : null}
        {pager}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">{chart}</div>
        {segmented ? <Legend series={shaped.series} vertical /> : null}
      </div>
      {pager}
    </div>
  );
}
