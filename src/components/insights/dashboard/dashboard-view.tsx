"use client";

import "react-grid-layout/css/styles.css";
import { Ellipsis, Eye, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  addReportToDashboard,
  deleteDashboard,
  duplicateDashboard,
  duplicateReport,
  removeFromDashboard,
  renameDashboard,
  runInsightAction,
  saveLayout,
  saveQuickFilters,
} from "@/lib/insights/actions";
import { periodFilterIds } from "@/lib/insights/catalog";
import { chips } from "@/lib/insights/filters";
import type { ColorContext } from "@/lib/insights/palette";
import type { DashboardDetail, SidebarItem } from "@/lib/insights/queries";
import type { Catalog, InsightDefinition, InsightResult, Overrides, QuickFilters } from "@/lib/insights/types";
import { exportPng } from "../editor/export";
import { Picker } from "../picker";
import { ShareDialog } from "../share-dialog";
import { QuickFiltersBar } from "./quick-filters";
import { Widget } from "./widget";

const Grid = WidthProvider(GridLayout);
const ROW = 48;

type Props = {
  empresa: string;
  detail: DashboardDetail;
  catalog: Catalog;
  companyColors: Record<string, string>;
  canShare: boolean;
  canCreate: boolean;
  /** relatórios da empresa que podem entrar no painel */
  available: SidebarItem[];
};

type Run = { result: InsightResult | null; error: string | null; loading: boolean };

function overridesOf(q: QuickFilters): Overrides {
  return {
    ...(q.period ? { period: q.period } : {}),
    ...(q.userIds.length ? { user_ids: q.userIds } : {}),
    ...(q.pipelineId ? { pipeline_id: q.pipelineId } : {}),
  };
}

/** Definição com o período do painel nos filtros de data com período (para os chips do cartão). */
function withPeriod(catalog: Catalog, def: InsightDefinition, q: QuickFilters): InsightDefinition {
  if (!q.period) return def;
  const ids = new Set(periodFilterIds(catalog, def));
  return {
    ...def,
    parameters: {
      ...def.parameters,
      filter_by: def.parameters.filter_by.map((f) => (ids.has(f.filter) ? { ...f, period: q.period!.period, operands: [] } : f)),
    },
  };
}

export function DashboardView({ empresa, detail, catalog, companyColors, canShare, canCreate, available }: Props) {
  const router = useRouter();
  const { dashboard } = detail;
  const canEdit = detail.access === "edit";
  const [quick, setQuick] = useState<QuickFilters>(detail.quick);
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [items, setItems] = useState(detail.items);
  const [name, setName] = useState(dashboard.name);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [, start] = useTransition();
  const gridRef = useRef<HTMLDivElement>(null);
  const reports = useMemo(() => new Map(detail.reports.map((r) => [r.id, r])), [detail.reports]);
  const overrides = useMemo(() => overridesOf(quick), [quick]);
  const labelColors = useMemo(
    () => Object.fromEntries((catalog.options.labels ?? []).map((l) => [l.id, l.color ?? ""]).filter(([, c]) => c?.startsWith("#"))),
    [catalog.options.labels],
  );

  // itens novos do servidor (depois de adicionar/remover): substitui o layout local
  const [seenItems, setSeenItems] = useState(detail.items);
  if (seenItems !== detail.items) {
    setSeenItems(detail.items);
    setItems(detail.items);
  }
  const runId = useRef(0);

  const runAll = useCallback(
    async (ov: Overrides) => {
      const id0 = ++runId.current;
      const ids = detail.items.map((i) => i.reportId);
      setRuns((r) => Object.fromEntries(ids.map((id) => [id, { result: r[id]?.result ?? null, error: null, loading: true }])));
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++]!;
          const rep = reports.get(id);
          if (!rep) continue;
          const res = await runInsightAction(rep.companyId, rep.definition, ov).catch(() => ({ ok: false as const, error: "Falha ao carregar." }));
          // resultado de uma rodada antiga (o filtro mudou no meio): descarta
          if (id0 !== runId.current) return;
          setRuns((r) => ({ ...r, [id]: res.ok ? { result: res.data, error: null, loading: false } : { result: null, error: res.error, loading: false } }));
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    },
    [detail.items, reports],
  );

  useEffect(() => {
    const t = setTimeout(() => void runAll(overrides), 0);
    return () => clearTimeout(t);
  }, [runAll, overrides]);

  function changeQuick(q: QuickFilters) {
    setQuick(q);
    void saveQuickFilters(dashboard.id, q).then((r) => !r.ok && toast.error(r.error));
  }

  const layout: Layout[] = items.map((i) => ({ i: i.reportId, x: i.x, y: i.y, w: i.w, h: i.h, minW: 1, minH: 3 }));
  function persist(l: Layout[]) {
    const next = l.map((x) => ({ reportId: x.i, x: x.x, y: x.y, w: x.w, h: x.h }));
    const changed = next.some((n) => {
      const o = items.find((i) => i.reportId === n.reportId);
      return !o || o.x !== n.x || o.y !== n.y || o.w !== n.w || o.h !== n.h;
    });
    if (!changed) return;
    setItems(next);
    void saveLayout(dashboard.id, next).then((r) => !r.ok && toast.error(r.error));
  }

  function rename() {
    const n = name.trim();
    if (!n || n === dashboard.name) return setName(dashboard.name);
    start(async () => {
      const r = await renameDashboard(dashboard.id, n);
      if (!r.ok) {
        toast.error(r.error);
        setName(dashboard.name);
      } else router.refresh();
    });
  }

  const onBoard = new Set(items.map((i) => i.reportId));
  const addable = available.filter((r) => !onBoard.has(r.id) && r.companyId === dashboard.companyId);

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Nome do painel"
            className="h-9 max-w-md border-transparent px-1 font-heading text-lg font-semibold shadow-none hover:border-input focus-visible:border-input"
          />
        ) : (
          <h1 className="font-heading text-lg font-semibold">{name}</h1>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground print:hidden">
          {canEdit ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
          {canEdit ? "Editor" : "Visualizador"}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {canEdit ? (
            <Picker
              options={addable.map((r) => ({ id: r.id, label: r.name }))}
              value={[]}
              ariaLabel="Adicionar relatório"
              align="end"
              icon={
                <>
                  <Plus className="size-4" /> Adicionar relatório
                </>
              }
              onChange={(ids) =>
                ids[0] &&
                start(async () => {
                  const r = await addReportToDashboard(dashboard.id, ids[0]!);
                  if (!r.ok) return void toast.error(r.error);
                  router.refresh();
                })
              }
            />
          ) : null}
          <QuickFiltersBar value={quick} onChange={changeQuick} users={catalog.options.users ?? []} pipelines={catalog.options.pipelines ?? []} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="size-8 print:hidden" aria-label="Ações do painel">
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {detail.isOwner && canShare ? <DropdownMenuItem onSelect={() => setShareOpen(true)}>Compartilhar com usuários e link público</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={() => window.print()}>Exportar PDF</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => gridRef.current && exportPng(gridRef.current, name)}>Exportar PNG</DropdownMenuItem>
              <DropdownMenuSeparator />
              {canCreate ? (
                <DropdownMenuItem
                  onSelect={() =>
                    start(async () => {
                      const r = await duplicateDashboard(dashboard.id);
                      if (!r.ok) return void toast.error(r.error);
                      router.push(`/${empresa}/relatorios/paineis/${r.data.id}`);
                    })
                  }
                >
                  Duplicar para seus painéis
                </DropdownMenuItem>
              ) : null}
              {detail.isOwner ? (
                <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDelete(true)}>
                  Excluir dos seus painéis
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Este painel ainda não tem relatórios. {canEdit ? "Use “Adicionar relatório” ou o botão “Adicionar ao painel” no editor de um relatório." : null}
        </div>
      ) : (
        <div ref={gridRef} className="-mx-1.5 bg-background">
          <Grid
            layout={layout}
            cols={4}
            rowHeight={ROW}
            margin={[12, 12]}
            containerPadding={[6, 0]}
            isDraggable={canEdit}
            isResizable={canEdit}
            draggableHandle=".widget-drag"
            compactType="vertical"
            onDragStop={persist}
            onResizeStop={persist}
            useCSSTransforms
          >
            {items.map((i) => {
              const rep = reports.get(i.reportId);
              const run = runs[i.reportId];
              if (!rep) return <div key={i.reportId} />;
              const shown = withPeriod(catalog, rep.definition, quick);
              return (
                <div key={i.reportId}>
                  <Widget
                    name={rep.name}
                    href={`/${empresa}/relatorios/r/${rep.id}`}
                    def={rep.definition}
                    chips={chips(catalog, shown)}
                    result={run?.result ?? null}
                    error={run?.error ?? null}
                    loading={run?.loading ?? true}
                    colors={{ report: rep.definition.colors, company: companyColors, record: labelColors } satisfies ColorContext}
                    draggable={canEdit}
                    onRemove={
                      canEdit
                        ? () =>
                            start(async () => {
                              const r = await removeFromDashboard(dashboard.id, rep.id);
                              if (!r.ok) return void toast.error(r.error);
                              setItems((x) => x.filter((y) => y.reportId !== rep.id));
                              router.refresh();
                            })
                        : undefined
                    }
                    onDuplicate={
                      canCreate
                        ? () =>
                            start(async () => {
                              const r = await duplicateReport(rep.id);
                              if (!r.ok) return void toast.error(r.error);
                              router.push(`/${empresa}/relatorios/r/${r.data.id}`);
                            })
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </Grid>
        </div>
      )}

      {detail.isOwner ? (
        <ShareDialog kind="dashboard" id={dashboard.id} companyId={dashboard.companyId} open={shareOpen} onOpenChange={setShareOpen} publicLink={canShare} />
      ) : null}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir painel?</AlertDialogTitle>
            <AlertDialogDescription>Os relatórios continuam salvos; só o painel sai. Não dá para desfazer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                start(async () => {
                  const r = await deleteDashboard(dashboard.id);
                  if (!r.ok) return void toast.error(r.error);
                  router.push(`/${empresa}/relatorios`);
                })
              }
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
