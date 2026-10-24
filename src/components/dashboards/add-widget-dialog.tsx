"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_COLS, MAX_ROWS } from "@/lib/dashboards/layout";
import { addWidget } from "@/lib/reports/actions";
import { PRESETS } from "@/lib/reports/presets";
import type { PresetReportSpec } from "@/lib/reports/spec";

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Choice = { kind: "preset"; key: string } | { kind: "report"; id: string };

/** Adiciona um relatório pronto ou um relatório salvo ao dashboard, com título e tamanho. */
export function AddWidgetDialog({
  dashboardId,
  reports,
  pipelines,
  defaultPipeline,
}: {
  dashboardId: string;
  reports: { id: string; name: string }[];
  pipelines: { value: string; label: string }[];
  defaultPipeline: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [title, setTitle] = useState("");
  const [colSpan, setColSpan] = useState(2);
  const [rowSpan, setRowSpan] = useState(1);
  const [pipeline, setPipeline] = useState(defaultPipeline ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsPipeline = choice?.kind === "preset" && choice.key === "stage_conversion";

  function reset() {
    setChoice(null);
    setTitle("");
    setColSpan(2);
    setRowSpan(1);
    setPipeline(defaultPipeline ?? "");
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!choice) {
      setError("Escolha um relatório.");
      return;
    }
    let payload: Parameters<typeof addWidget>[1];
    if (choice.kind === "report") {
      payload = { reportId: choice.id, title, colSpan, rowSpan };
    } else {
      const preset = PRESETS.find((p) => p.key === choice.key);
      if (!preset) return;
      if (needsPipeline && !pipeline) {
        setError("Escolha o funil.");
        return;
      }
      // Período vazio: o widget segue o período do dashboard.
      const spec: PresetReportSpec = { kind: preset.key, chart: preset.chart };
      if (needsPipeline) spec.params = { pipeline };
      payload = { spec, title: title.trim() || preset.name, colSpan, rowSpan };
    }
    setError(null);
    startTransition(async () => {
      const res = await addWidget(dashboardId, payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Widget adicionado.");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Adicionar widget</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Adicionar widget</DialogTitle>
            <DialogDescription>Escolha um relatório pronto ou um dos seus relatórios salvos.</DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Relatórios prontos</legend>
            <div role="radiogroup" aria-label="Relatórios prontos" className="grid gap-1">
              {PRESETS.map((p) => (
                <label key={p.key} className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent">
                  <input
                    type="radio"
                    name="widget-choice"
                    className="mt-1"
                    checked={choice?.kind === "preset" && choice.key === p.key}
                    onChange={() => setChoice({ kind: "preset", key: p.key })}
                  />
                  <span>
                    <span className="font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {reports.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Meus relatórios</legend>
              <div role="radiogroup" aria-label="Meus relatórios" className="grid gap-1">
                {reports.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent">
                    <input
                      type="radio"
                      name="widget-choice"
                      checked={choice?.kind === "report" && choice.id === r.id}
                      onChange={() => setChoice({ kind: "report", id: r.id })}
                    />
                    <span className="font-medium">{r.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {needsPipeline ? (
            <div className="space-y-1.5">
              <Label htmlFor="widget-pipeline">Funil</Label>
              <select id="widget-pipeline" className={selectCls} value={pipeline} onChange={(e) => setPipeline(e.target.value)}>
                <option value="">Escolha o funil</option>
                {pipelines.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="widget-title">Título</Label>
            <Input id="widget-title" value={title} maxLength={120} placeholder="Padrão: nome do relatório" onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="widget-cols">Largura</Label>
              <select id="widget-cols" className={selectCls} value={colSpan} onChange={(e) => setColSpan(Number(e.target.value))}>
                {Array.from({ length: MAX_COLS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} de {MAX_COLS} colunas
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="widget-rows">Altura</Label>
              <select id="widget-rows" className={selectCls} value={rowSpan} onChange={(e) => setRowSpan(Number(e.target.value))}>
                {Array.from({ length: MAX_ROWS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "linha" : "linhas"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adicionando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
