import "server-only";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { DashboardFilters } from "@/components/dashboards/dashboard-filters";
import { DashboardView, type WidgetLoader } from "@/components/dashboards/dashboard-view";
import { dayKey } from "@/lib/activities/time";
import { resolveDashboardFilters } from "@/lib/dashboards/filters";
import { buildWidgetFilters, type DashboardFilters as Filters } from "@/lib/reports/filters";
import type { WidgetRow } from "@/lib/reports/rows";
import { toReportResult, type ReportSpec } from "@/lib/reports/spec";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";

// Página pública, sem sessão e sem cache: a revogação precisa valer na hora (connection() abaixo).
export const instant = false;

// Fora dos buscadores, e sem enviar o token como Referer para links ou recursos de terceiros.
export const metadata: Metadata = {
  title: "Dashboard | Oxyn",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** 32 bytes em base64url sem preenchimento: exatamente 43 caracteres. Outro formato nem chega ao banco. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type PublicDashboard = {
  name: string;
  default_filters: Filters | null;
  widgets: { id: string; title: string | null; col_span: number; row_span: number; chart: string | null }[];
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PublicDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();
  await connection();

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("dashboard_public", { p_token: token });
  // Erro do banco, token desconhecido, expirado ou revogado: a mesma resposta, sem pistas.
  const dash = data as PublicDashboard | null;
  if (error || !dash || typeof dash.name !== "string" || !Array.isArray(dash.widgets)) notFound();

  const sp = await searchParams;
  // O período é o único filtro que a URL pública controla; empresa, responsável e equipe vêm só do padrão do dashboard.
  const filters = resolveDashboardFilters({ de: first(sp.de), ate: first(sp.ate) }, dash.default_filters ?? {}, null, null);
  const urlOnly = resolveDashboardFilters({ de: first(sp.de), ate: first(sp.ate) }, {}, null, null);
  const today = dayKey(new Date());

  const widgets: WidgetRow[] = dash.widgets
    .filter((w) => isUuid(w.id))
    .map((w, i) => ({
      id: w.id,
      dashboardId: "publico",
      reportId: null,
      spec: w.chart ? ({ chart: w.chart } as unknown as ReportSpec) : null,
      title: w.title ?? "",
      position: i,
      colSpan: w.col_span,
      rowSpan: w.row_span,
    }));

  const load: WidgetLoader = async (widgetId, f) => {
    const { data: raw, error: err } = await createAdminClient().rpc("run_widget_public", {
      p_token: token,
      p_widget: widgetId,
      p_filters: buildWidgetFilters(f),
    });
    if (err) {
      console.error("[dashboard público] widget:", err.code, err.message);
      return { ok: false, error: "Não foi possível carregar este widget." };
    }
    return { ok: true, data: toReportResult(raw) };
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-6 md:px-8">
      <header className="flex items-center gap-3 border-b pb-4">
        <Image src="/oxyn-mark.png" alt="Oxyn" width={36} height={36} priority />
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Oxyn</p>
          <h1 className="font-heading text-2xl font-semibold">{dash.name}</h1>
        </div>
      </header>

      <DashboardFilters today={today} period={urlOnly.period ?? null} companies={null} company="" />

      <DashboardView dashboardId="publico" widgets={widgets} filters={filters} readOnly load={load} />
    </main>
  );
}
