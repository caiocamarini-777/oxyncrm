import "server-only";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { StaticGrid } from "@/components/insights/dashboard/static-grid";
import { Widget } from "@/components/insights/dashboard/widget";
import { PERIOD_LABEL } from "@/lib/insights/meta";
import { toDefinition } from "@/lib/insights/queries";
import { PERIODS, type InsightResult, type PeriodKey } from "@/lib/insights/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/uuid";

// Página pública, sem sessão e sem cache: a revogação precisa valer na hora (connection() abaixo).
export const instant = false;

// Fora dos buscadores, e sem enviar o token como Referer para links ou recursos de terceiros.
export const metadata: Metadata = {
  title: "Painel | Oxyn",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** 32 bytes em base64url sem preenchimento: exatamente 43 caracteres. Outro formato nem chega ao banco. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

type PublicItem = {
  report_id: string;
  name: string;
  data_type: string;
  report_type: string;
  chart_type: string;
  parameters: unknown;
  columns: unknown;
  colors: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
};
type PublicDashboard = { id: string; name: string; company_id: string; items: PublicItem[] };

export default async function PublicDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();
  await connection();

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("insights_public_dashboard", { p_token: token });
  // Erro do banco, token desconhecido, expirado ou revogado: a mesma resposta, sem pistas.
  const dash = data as PublicDashboard | null;
  if (error || !dash || typeof dash.name !== "string" || !Array.isArray(dash.items)) notFound();

  const sp = await searchParams;
  const period = (PERIODS as readonly string[]).includes(sp.periodo ?? "") && sp.periodo !== "custom" ? (sp.periodo as PeriodKey) : null;
  const items = dash.items.filter((i) => isUuid(i.report_id));
  const [runs, colors] = await Promise.all([
    Promise.all(
      items.map(async (i) => {
        const { data: r, error: err } = await supabase.rpc("insights_run_public", {
          p_token: token,
          p_report: i.report_id,
          p_overrides: period ? { period: { period } } : {},
        });
        if (err) console.error("[painel público] relatório:", err.code, err.message);
        return [i.report_id, err ? null : (r as InsightResult)] as const;
      }),
    ),
    supabase.from("insight_colors").select("field, value, color").eq("company_id", dash.company_id),
  ]);
  const results = new Map(runs);
  const company = Object.fromEntries((colors.data ?? []).map((c) => [`${c.field}:${c.value}`, c.color]));
  const byId = new Map(items.map((i) => [i.report_id, i]));

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-4 py-6 md:px-8">
      <header className="flex items-center gap-3 border-b pb-4">
        <Image src="/oxyn-mark.png" alt="Oxyn" width={36} height={36} priority />
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Oxyn</p>
          <h1 className="font-heading text-2xl font-semibold">{dash.name}</h1>
        </div>
        {period ? <span className="ml-auto rounded-full bg-muted px-3 py-1 text-xs">{PERIOD_LABEL[period]}</span> : null}
      </header>
      <StaticGrid
        items={items.map((i) => ({ reportId: i.report_id, x: i.x, y: i.y, w: i.w, h: i.h }))}
        render={(id) => {
          const i = byId.get(id)!;
          const def = toDefinition(i);
          const result = results.get(id) ?? null;
          return (
            <Widget
              name={i.name}
              def={def}
              chips={[]}
              result={result}
              error={result ? null : "Não foi possível carregar este relatório."}
              loading={false}
              colors={{ report: def.colors, company }}
            />
          );
        }}
      />
    </main>
  );
}
