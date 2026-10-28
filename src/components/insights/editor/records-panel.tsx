"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Loader2, Settings, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { recordsAction } from "@/lib/insights/actions";
import { columnGroups } from "@/lib/insights/catalog";
import { shapeChart } from "@/lib/insights/chart-shape";
import { formatCell } from "@/lib/insights/format";
import { DATA_TYPE_LABEL, DATA_TYPE_PLURAL } from "@/lib/insights/meta";
import type { ColorContext } from "@/lib/insights/palette";
import type { Catalog, DataType, InsightDefinition, InsightResult, Overrides, RecordsResult } from "@/lib/insights/types";
import { PivotTable } from "../chart/pivot-table";
import type { PointClick } from "../chart/insight-chart";
import { Picker } from "../picker";
import { exportRecordsCsv } from "./export";

const LINK: Partial<Record<DataType, string>> = {
  deals: "negocios",
  leads: "leads",
  people: "contatos/pessoas",
  organizations: "contatos/organizacoes",
};

type Props = {
  empresa: string;
  companyId: string;
  catalog: Catalog;
  def: InsightDefinition;
  overrides: Overrides;
  result: InsightResult | null;
  colors: ColorContext;
  point: PointClick | null;
  onClearPoint: () => void;
  onColumns: (cols: string[]) => void;
  canEdit: boolean;
  name: string;
};

/** Parte de baixo do editor: a lista de registros (colunas configuráveis) e a aba "Resumo". */
export function RecordsPanel({ empresa, companyId, catalog, def, overrides, result, colors, point, onClearPoint, onColumns, canEdit, name }: Props) {
  const [tab, setTab] = useState<"list" | "summary">("list");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [data, setData] = useState<RecordsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify([def, overrides, point, sort, page]);

  useEffect(() => {
    if (tab !== "list") return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await recordsAction(companyId, def, overrides, page, sort, point);
      if (cancelled) return;
      setLoading(false);
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else setError(r.error);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // key resume as dependências que mudam o resultado
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tab, companyId]);

  useEffect(() => setPage(0), [point, def.parameters.filter_by]);

  const groups = useMemo(() => columnGroups(catalog, def.data_type), [catalog, def.data_type]);
  const colOptions = groups.flatMap((g) =>
    g.fields.map((f) => ({ id: f.id, label: f.name, group: g.prefix ? DATA_TYPE_LABEL[g.entity] : f.custom ? "Campos personalizados" : DATA_TYPE_LABEL[g.entity] })),
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / 50)) : 1;
  const base = LINK[def.data_type];
  const pointLabel = point?.x !== undefined ? (result?.x.find((p) => p.key === point.x)?.label ?? point.x) : null;
  const segLabel = point?.s !== undefined ? (result?.segments.find((p) => p.key === point.s)?.label ?? point.s) : null;

  return (
    <section className="rounded-lg border bg-card" aria-label="Registros">
      <header className="flex flex-wrap items-center gap-2 border-b px-3">
        <div role="tablist" className="flex">
          {(["list", "summary"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`border-b-2 px-3 py-2 text-sm ${tab === t ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              {t === "list" ? DATA_TYPE_PLURAL[def.data_type].toUpperCase() : "Resumo"}
            </button>
          ))}
        </div>
        {pointLabel || segLabel ? (
          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
            {[pointLabel, segLabel].filter(Boolean).join(" · ")}
            <button onClick={onClearPoint} aria-label="Tirar filtro do gráfico">
              <X className="size-3" />
            </button>
          </span>
        ) : null}
        {tab === "list" ? (
          <div className="ml-auto flex items-center gap-1.5 py-1.5">
            {loading ? <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Carregando" /> : null}
            {data ? <span className="text-xs text-muted-foreground">{data.total} registros</span> : null}
            <Button variant="outline" size="sm" disabled={!data?.rows.length} onClick={() => data && exportRecordsCsv(name, data)}>
              <Download className="size-4" /> Exportar
            </Button>
            {canEdit ? (
              <Picker
                multi
                options={colOptions}
                value={data?.columns.map((c) => c.id) ?? def.columns}
                ariaLabel="Colunas"
                align="end"
                className="size-8 px-0"
                icon={<Settings className="size-4" />}
                onChange={(ids) => onColumns(ids)}
              />
            ) : null}
          </div>
        ) : null}
      </header>
      {tab === "summary" ? (
        <div className="p-3">{result ? <PivotTable result={result} shaped={shapeChart(result, def, colors)} /> : null}</div>
      ) : error ? (
        <p className="p-4 text-sm text-destructive">{error}</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {data?.columns.map((c) => {
                  const active = sort?.col === c.id;
                  const numeric = c.type === "currency" || c.type === "number";
                  return (
                    <TableHead key={c.id} className={numeric ? "text-right" : undefined}>
                      <button
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() => setSort(active && sort?.dir === "desc" ? { col: c.id, dir: "asc" } : { col: c.id, dir: "desc" })}
                      >
                        {c.label}
                        {active ? sort?.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : null}
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((row) => (
                <TableRow key={String(row[0])}>
                  {data.columns.map((c, i) => {
                    const text = formatCell(row[i + 1], c.type);
                    const numeric = c.type === "currency" || c.type === "number";
                    return (
                      <TableCell key={c.id} className={numeric ? "text-right tabular-nums" : "max-w-72 truncate"} title={text}>
                        {i === 0 && base ? (
                          <Link href={`/${empresa}/${base}/${row[0]}`} className="font-medium text-primary hover:underline">
                            {text || "(sem título)"}
                          </Link>
                        ) : (
                          text
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data && data.rows.length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">Nenhum registro.</p> : null}
          {pages > 1 ? (
            <div className="flex items-center justify-end gap-1 border-t px-3 py-2 text-xs text-muted-foreground">
              <Button variant="ghost" size="icon" className="size-7" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">
                <ChevronLeft className="size-4" />
              </Button>
              {page + 1} / {pages}
              <Button variant="ghost" size="icon" className="size-7" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Próxima página">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
