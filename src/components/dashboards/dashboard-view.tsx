import { Suspense } from "react";
import { ReportChart } from "@/components/reports/report-chart";
import type { ActionResult } from "@/lib/db-errors";
import type { DashboardFilters } from "@/lib/reports/filters";
import type { WidgetRow } from "@/lib/reports/rows";
import type { Chart, ReportResult } from "@/lib/reports/spec";
import { DashboardGrid } from "./dashboard-grid";

/** Carrega os dados de um widget; a página do dono usa runWidgetResult, a pública usa o carregador por link. */
export type WidgetLoader = (widgetId: string, filters: DashboardFilters) => Promise<ActionResult<ReportResult>>;

function chartOf(widget: WidgetRow, result: ReportResult): Chart {
  if (result.chart) return result.chart;
  const spec = widget.spec;
  return spec?.chart ?? "table";
}

async function WidgetBody({ widget, filters, load }: { widget: WidgetRow; filters: DashboardFilters; load: WidgetLoader }) {
  const res = await load(widget.id, filters);
  if (!res.ok) {
    return (
      <p role="alert" className="py-6 text-center text-sm text-destructive">
        {res.error}
      </p>
    );
  }
  return <ReportChart result={res.data} chart={chartOf(widget, res.data)} compact title={widget.title} />;
}

function WidgetSkeleton() {
  return (
    <div role="status" aria-label="Carregando widget" className="space-y-3 py-2">
      <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-32 animate-pulse rounded bg-muted" />
    </div>
  );
}

/**
 * Grade de widgets de um dashboard. Cada widget carrega os próprios dados dentro do próprio Suspense.
 * É reutilizado pela página pública com outro `load`.
 */
export function DashboardView({
  dashboardId,
  widgets,
  filters,
  readOnly,
  load,
}: {
  dashboardId: string;
  widgets: WidgetRow[];
  filters: DashboardFilters;
  readOnly: boolean;
  load: WidgetLoader;
}) {
  if (widgets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
        {readOnly ? "Este dashboard ainda não tem widgets." : "Este dashboard ainda não tem widgets. Use Adicionar widget."}
      </p>
    );
  }
  // O filtro entra na chave: ao mudar, cada widget volta ao estado de carregamento em vez de mostrar o valor antigo.
  const filterKey = JSON.stringify(filters);
  const items = widgets.map((w) => ({
    id: w.id,
    title: w.title || "Sem título",
    colSpan: w.colSpan,
    rowSpan: w.rowSpan,
    content: (
      <Suspense key={filterKey} fallback={<WidgetSkeleton />}>
        <WidgetBody widget={w} filters={filters} load={load} />
      </Suspense>
    ),
  }));
  return <DashboardGrid dashboardId={dashboardId} items={items} readOnly={readOnly} />;
}
