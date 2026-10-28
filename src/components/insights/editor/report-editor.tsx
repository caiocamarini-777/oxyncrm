"use client";

import { Ellipsis, Eye, LayoutDashboard, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addReportToDashboard,
  createDashboard,
  createReport,
  deleteReport,
  duplicateReport,
  runInsightAction,
  saveCompanyColor,
  saveMyColors,
  saveReport,
} from "@/lib/insights/actions";
import { defaultDefinition } from "@/lib/insights/definition";
import { runnable } from "@/lib/insights/filters";
import { entityOf } from "@/lib/insights/meta";
import type { ColorContext } from "@/lib/insights/palette";
import type { Catalog, InsightDefinition, InsightResult, Overrides } from "@/lib/insights/types";
import type { ColorsSave } from "../chart/chart-colors-dialog";
import type { PointClick } from "../chart/insight-chart";
import { EntityIcon } from "../entity-icon";
import { ShareDialog } from "../share-dialog";
import { ChartCard } from "./chart-card";
import { FilterPanel } from "./filter-panel";
import { RecordsPanel } from "./records-panel";

type Props = {
  empresa: string;
  companyId: string;
  report: { id: string; name: string } | null;
  initial: InsightDefinition;
  catalog: Catalog;
  companyColors: Record<string, string>;
  savedColors: string[];
  canEdit: boolean;
  isOwner: boolean;
  canShare: boolean;
  canCreate: boolean;
  dashboards: { id: string; name: string }[];
};

export function ReportEditor(props: Props) {
  const { empresa, companyId, report, catalog, canEdit } = props;
  const router = useRouter();
  const [saved, setSaved] = useState<InsightDefinition>(props.initial);
  const [def, setDef] = useState<InsightDefinition>(props.initial);
  const [name, setName] = useState(report?.name ?? "");
  const [savedName, setSavedName] = useState(report?.name ?? "");
  const [result, setResult] = useState<InsightResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [compare, setCompare] = useState<Overrides["compare"]>(null);
  const [point, setPoint] = useState<PointClick | null>(null);
  const [myColors, setMyColors] = useState(props.savedColors);
  const [companyColors, setCompanyColors] = useState(props.companyColors);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const dirty = !report || JSON.stringify(def) !== JSON.stringify(saved) || name !== savedName;
  const entity = entityOf(def.data_type, def.report_type);
  const runDef = useMemo(() => runnable(def), [def]);
  const runKey = JSON.stringify([runDef, compare]);
  const colors: ColorContext = useMemo(
    () => ({
      report: def.colors,
      company: companyColors,
      record: Object.fromEntries((catalog.options.labels ?? []).map((l) => [l.id, l.color ?? ""]).filter(([, c]) => c?.startsWith("#"))),
    }),
    [def.colors, companyColors, catalog.options.labels],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const r = await runInsightAction(companyId, runDef, compare ? { compare } : {});
      if (cancelled) return;
      setLoading(false);
      if (r.ok) {
        setResult(r.data);
        setError(null);
      } else setError(r.error);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // runKey resume runDef e compare
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, companyId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (next: InsightDefinition) => {
    setDef(next);
    setPoint(null);
  };

  function switchType(value: string) {
    const t = entity.types.find((x) => `${x.dataType}:${x.reportType}` === value);
    if (!t) return;
    const next = defaultDefinition(t.dataType, t.reportType);
    // mantém os filtros da mesma entidade
    if (t.dataType === def.data_type) next.parameters.filter_by = def.parameters.filter_by;
    change({ ...next, colors: def.colors });
  }

  async function save(): Promise<string | null> {
    const n = name.trim() || "Novo relatório";
    if (!report) {
      const r = await createReport({ companyId, name: n, definition: def });
      if (!r.ok) {
        toast.error(r.error);
        return null;
      }
      toast.success("Relatório salvo.");
      router.replace(`/${empresa}/relatorios/r/${r.data.id}`);
      return r.data.id;
    }
    const r = await saveReport(report.id, { name: n, definition: def });
    if (!r.ok) {
      toast.error(r.error);
      return null;
    }
    setSaved(def);
    setName(n);
    setSavedName(n);
    toast.success("Relatório salvo.");
    router.refresh();
    return report.id;
  }

  function addTo(dashboardId: string | "new") {
    start(async () => {
      const id = report && !dirty ? report.id : await save();
      if (!id) return;
      let dash = dashboardId;
      if (dash === "new") {
        const d = await createDashboard({ companyId, name: "Novo painel" });
        if (!d.ok) return void toast.error(d.error);
        dash = d.data.id;
      }
      const r = await addReportToDashboard(dash, id);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Relatório adicionado ao painel.", {
        action: { label: "Abrir painel", onClick: () => router.push(`/${empresa}/relatorios/paineis/${dash}`) },
      });
    });
  }

  async function onColorsSave(s: ColorsSave, field: string) {
    const nextColors = { ...def.colors, ...s.report };
    const next = { ...def, colors: nextColors };
    setDef(next);
    // as cores valem na hora (como no Pipedrive), sem levar as outras mudanças pendentes
    if (report) {
      const r = await saveReport(report.id, { definition: { ...saved, colors: nextColors } });
      if (r.ok) setSaved((x) => ({ ...x, colors: nextColors }));
      else toast.error(r.error);
    }
    for (const [key, color] of Object.entries(s.company)) {
      const r = await saveCompanyColor(companyId, field, key, color);
      if (r.ok) setCompanyColors((c) => ({ ...c, [`${field}:${key}`]: color }));
      else toast.error(r.error);
    }
    if (JSON.stringify(s.saved) !== JSON.stringify(myColors)) {
      const r = await saveMyColors(s.saved);
      if (r.ok) setMyColors(s.saved);
    }
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center gap-2">
        <EntityIcon icon={entity.icon} className="size-5 text-muted-foreground" />
        {canEdit ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Novo relatório"
            aria-label="Nome do relatório"
            className="h-9 max-w-md border-transparent px-1 font-heading text-lg font-semibold shadow-none hover:border-input focus-visible:border-input"
          />
        ) : (
          <h1 className="font-heading text-lg font-semibold">{name}</h1>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {canEdit ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
            {canEdit ? "Editor" : "Visualizador"}
          </span>
          {canEdit && dirty ? (
            <>
              {report ? (
                <Button variant="ghost" size="sm" onClick={() => (setDef(saved), setName(savedName))}>
                  Descartar
                </Button>
              ) : null}
              <Button size="sm" onClick={() => start(async () => void (await save()))} disabled={pending}>
                Salvar
              </Button>
            </>
          ) : null}
          {props.canCreate ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}>
                  <LayoutDashboard className="size-4" /> Adicionar ao painel
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Seus painéis</DropdownMenuLabel>
                {props.dashboards.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => addTo(d.id)}>
                    {d.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => addTo("new")}>
                  <Plus className="size-4" /> Novo painel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {report ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label="Mais ações">
                  <Ellipsis className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {props.canCreate ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      start(async () => {
                        const r = await duplicateReport(report.id);
                        if (!r.ok) return void toast.error(r.error);
                        router.push(`/${empresa}/relatorios/r/${r.data.id}`);
                      })
                    }
                  >
                    Duplicar
                  </DropdownMenuItem>
                ) : null}
                {props.isOwner && props.canShare ? <DropdownMenuItem onSelect={() => setShareOpen(true)}>Compartilhar</DropdownMenuItem> : null}
                {props.isOwner ? (
                  <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmDelete(true)}>
                    Excluir
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      <div className="flex items-center gap-2">
        <Select value={`${def.data_type}:${def.report_type}`} onValueChange={switchType} disabled={!canEdit || entity.types.length < 2}>
          <SelectTrigger size="sm" className="w-auto font-medium" aria-label="Tipo de relatório">
            <SelectValue>{entity.types.find((t) => t.dataType === def.data_type && t.reportType === def.report_type)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {entity.types.map((t) => (
              <SelectItem key={t.reportType + t.dataType} value={`${t.dataType}:${t.reportType}`}>
                <span className="flex flex-col">
                  <span>{t.label}</span>
                  <span className="text-xs text-muted-foreground">{t.description}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FilterPanel
        catalog={catalog}
        def={def}
        companyId={companyId}
        readOnly={!canEdit}
        onChange={(filter_by) => change({ ...def, parameters: { ...def.parameters, filter_by } })}
      />

      <ChartCard
        catalog={catalog}
        def={def}
        name={name || "relatorio"}
        result={result}
        loading={loading}
        error={error}
        colors={colors}
        savedColors={myColors}
        canEdit={canEdit}
        canSetCompanyColor={props.canCreate}
        compare={compare}
        onCompare={setCompare}
        onChange={change}
        onColorsSave={onColorsSave}
        onPointClick={setPoint}
      />

      <RecordsPanel
        empresa={empresa}
        companyId={companyId}
        catalog={catalog}
        def={runDef}
        overrides={{}}
        result={result}
        colors={colors}
        point={point}
        onClearPoint={() => setPoint(null)}
        onColumns={(columns) => setDef({ ...def, columns })}
        canEdit={canEdit}
        name={name || "relatorio"}
      />

      {report ? <ShareDialog kind="report" id={report.id} companyId={companyId} open={shareOpen} onOpenChange={setShareOpen} /> : null}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir relatório?</AlertDialogTitle>
            <AlertDialogDescription>O relatório sai de todos os painéis em que está. Não dá para desfazer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                report &&
                start(async () => {
                  const r = await deleteReport(report.id);
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
