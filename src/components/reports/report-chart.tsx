"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EMPTY_TEXT, TRUNCATED_TEXT, isNumeric, shape, summarize } from "@/lib/reports/chart-data";
import { formatCell } from "@/lib/reports/format";
import type { Chart, ReportResult } from "@/lib/reports/spec";

/** Paleta fixa: tons de teal e neutros. */
export const CHART_COLORS = ["#1A82A2", "#6498A8", "#75ACBA", "#3E6B78", "#A9C9D2", "#5A5F63"];

function ResultTable({ result }: { result: ReportResult }) {
  return (
    <div className="max-h-96 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {result.columns.map((c) => (
              <TableHead key={c.key} className={isNumeric(c) ? "text-right" : undefined}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row, i) => (
            <TableRow key={i}>
              {result.columns.map((c, j) => (
                <TableCell key={c.key} className={isNumeric(c) ? "text-right tabular-nums" : undefined}>
                  {formatCell(row[j], c.type)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Funnel({ result, compact }: { result: ReportResult; compact: boolean }) {
  const { series, data } = shape(result);
  const s = series[0];
  if (!s) return <ResultTable result={result} />;
  const values = data.map((d) => d[s.col.key] as number);
  const max = Math.max(...values, 1);
  return (
    <ol className={compact ? "space-y-1" : "space-y-2"}>
      {data.map((d, i) => {
        const v = values[i]!;
        const prev = i > 0 ? values[i - 1]! : null;
        const rate = prev !== null && prev > 0 ? (v / prev) * 100 : null;
        return (
          <li key={i} className="space-y-0.5">
            {rate !== null ? (
              <p className="pl-1 text-xs text-muted-foreground">
                {formatCell(rate, "percent")} da etapa anterior
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm" title={String(d.__cat)}>
                {String(d.__cat)}
              </span>
              <div className="h-7 flex-1 rounded bg-muted">
                <div
                  className="flex h-full min-w-fit items-center rounded px-2 text-xs font-medium text-white"
                  style={{ width: `${Math.max((v / max) * 100, 2)}%`, background: CHART_COLORS[0] }}
                >
                  {formatCell(v, s.col.type)}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const tickStyle = { fontSize: 12, fill: "currentColor" };
const tooltipStyle = {
  background: "var(--color-popover, #fff)",
  color: "var(--color-popover-foreground, inherit)",
  border: "1px solid var(--color-border, #ddd)",
  borderRadius: 8,
  fontSize: 12,
};

function Plot({ result, chart, compact }: { result: ReportResult; chart: Chart; compact: boolean }) {
  const { series, data } = shape(result);
  const height = compact ? 180 : 320;
  const first = series[0];
  if (!first) return <ResultTable result={result} />;
  const fmt = (key: string) => (v: unknown) => {
    const col = series.find((s) => s.col.key === key)?.col;
    return formatCell(v, col?.type ?? "number");
  };
  const tip = (
    <Tooltip
      contentStyle={tooltipStyle}
      formatter={(v, name) => {
        const s = series.find((x) => x.col.label === name);
        return formatCell(v, s?.col.type ?? "number");
      }}
    />
  );
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.15} />
      <XAxis dataKey="__cat" tick={tickStyle} interval="preserveStartEnd" />
      <YAxis tick={tickStyle} width={compact ? 48 : 72} tickFormatter={fmt(first.col.key)} />
      {tip}
      {series.length > 1 && !compact ? <Legend /> : null}
    </>
  );
  return (
    <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 480, height }}>
      {chart === "pie" ? (
        <PieChart>
          <Pie
            data={data}
            dataKey={first.col.key}
            nameKey="__cat"
            outerRadius={compact ? 70 : 110}
            label={compact ? false : (p) => String(p.name)}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatCell(v, first.col.type)} />
          {!compact ? <Legend /> : null}
        </PieChart>
      ) : chart === "line" ? (
        <LineChart data={data}>
          {axes}
          {series.map((s, i) => (
            <Line
              key={s.col.key}
              type="monotone"
              dataKey={s.col.key}
              name={s.col.label}
              stroke={CHART_COLORS[i % CHART_COLORS.length]}
              strokeWidth={2}
              dot={data.length < 30}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={data}>
          {axes}
          {series.map((s, i) => (
            <Bar
              key={s.col.key}
              dataKey={s.col.key}
              name={s.col.label}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

/** Renderiza um resultado de relatório como número, barras, linha, funil, pizza ou tabela. */
export function ReportChart({
  result,
  chart,
  compact = false,
  title,
}: {
  result: ReportResult;
  chart: Chart;
  compact?: boolean;
  title?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const empty = result.rows.length === 0;
  const label = `${title ?? "Gráfico"}. ${summarize(result, chart)}`;

  let body: React.ReactNode;
  if (empty) {
    body = <p className="py-8 text-center text-sm text-muted-foreground">{EMPTY_TEXT}</p>;
  } else if (chart === "table" || asTable) {
    body = <ResultTable result={result} />;
  } else if (chart === "number") {
    const { series } = shape(result);
    const s = series[0];
    const raw = s ? result.rows[0]?.[s.idx] : null;
    body = (
      <div role="img" aria-label={label} className="py-4 text-center">
        <p className={compact ? "text-3xl font-semibold" : "text-5xl font-semibold"} style={{ color: CHART_COLORS[0] }}>
          {s && raw !== null && raw !== undefined ? formatCell(raw, s.col.type) : "Sem dados"}
        </p>
        {s ? <p className="mt-1 text-sm text-muted-foreground">{s.col.label}</p> : null}
      </div>
    );
  } else {
    body = (
      <div role="img" aria-label={label}>
        {chart === "funnel" ? <Funnel result={result} compact={compact} /> : <Plot result={result} chart={chart} compact={compact} />}
      </div>
    );
  }

  const canToggle = !empty && chart !== "table";
  return (
    <div className="space-y-2">
      {body}
      {result.truncated ? <p className="text-xs text-muted-foreground">{TRUNCATED_TEXT}</p> : null}
      {canToggle ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "Ver gráfico" : "Ver tabela"}
        </Button>
      ) : null}
    </div>
  );
}
