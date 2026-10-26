"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Clock, Columns3, LineChart, List, Search, Snowflake } from "lucide-react";
import { CompanyPicker } from "@/components/records/company-picker";
import { LABEL_FILTER, MultiSelect, type MultiOption } from "@/components/records/multi-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CompanySummary } from "@/lib/companies/pure";
import type { DealView } from "@/lib/deals/query";


const FILTER_KEYS = ["q", "owner", "team", "label", "rotting", "overdue", "stage", "page"];

export type DealFilterOptions = { owners: MultiOption[]; teams: MultiOption[]; labels: MultiOption[]; stages?: MultiOption[] };

/** Funil, visão (Kanban / Lista / Forecast), filtros e ações; tudo no estado da URL. */
export function DealsToolbar({
  pipelines,
  pipelineId,
  view,
  options,
  actions,
  allCompanies = false,
  companies = [],
}: {
  pipelines: { id: string; name: string }[];
  pipelineId: string | null;
  view: DealView;
  options: DealFilterOptions;
  actions?: ReactNode;
  /** Visão "Todas as empresas": só a lista; Kanban e Forecast pedem a empresa. */
  allCompanies?: boolean;
  companies?: CompanySummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [choosing, setChoosing] = useState<DealView | null>(null);
  const first = useRef(true);

  function push(next: URLSearchParams) {
    next.delete("page");
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }
  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  }
  function setMulti(key: string, values: string[]) {
    const next = new URLSearchParams(params.toString());
    next.delete(key);
    values.forEach((v) => next.append(key, v));
    push(next);
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      if (q.trim() === (params.get("q") ?? "")) return;
      set("q", q.trim() || null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = FILTER_KEYS.some((k) => k !== "page" && params.has(k));
  function clear() {
    const next = new URLSearchParams(params.toString());
    FILTER_KEYS.forEach((k) => next.delete(k));
    setQ("");
    push(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {pipelines.length > 0 && !allCompanies ? (
            <select
              aria-label="Funil"
              value={pipelineId ?? ""}
              onChange={(e) => {
                const next = new URLSearchParams(params.toString());
                next.delete("stage");
                if (e.target.value) next.set("funil", e.target.value);
                else next.delete("funil");
                push(next);
              }}
              className="h-8 max-w-64 rounded-md border border-input bg-background px-2 text-sm font-medium"
            >
              {view === "lista" ? <option value="">Todos os funis</option> : null}
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            aria-label="Visão"
            onValueChange={(v) => {
              if (!v) return;
              if (allCompanies && v !== "lista") {
                setChoosing(v as DealView);
                return;
              }
              setChoosing(null);
              const next = new URLSearchParams(params.toString());
              if (v === "kanban") next.delete("visao");
              else next.set("visao", v);
              if (v === "forecast") next.delete("status");
              next.delete("stage");
              push(next);
            }}
          >
            <ToggleGroupItem value="kanban" aria-label="Kanban">
              <Columns3 /> Kanban
            </ToggleGroupItem>
            <ToggleGroupItem value="lista" aria-label="Lista">
              <List /> Lista
            </ToggleGroupItem>
            <ToggleGroupItem value="forecast" aria-label="Forecast">
              <LineChart /> Forecast
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" aria-label="Buscar" className="h-8 w-56 pl-8" />
        </div>
        {options.stages && options.stages.length > 0 && view === "lista" ? (
          <MultiSelect label="Etapa" options={options.stages} value={params.getAll("stage")} onChange={(v) => setMulti("stage", v)} />
        ) : null}
        <MultiSelect label="Responsável" options={options.owners} value={params.getAll("owner")} onChange={(v) => setMulti("owner", v)} />
        <MultiSelect label="Equipe" options={options.teams} value={params.getAll("team")} onChange={(v) => setMulti("team", v)} />
        <MultiSelect
          label={LABEL_FILTER.label}
          hint={LABEL_FILTER.hint}
          options={options.labels} value={params.getAll("label")} onChange={(v) => setMulti("label", v)} />
        <Toggle
          variant="outline"
          size="sm"
          pressed={params.get("rotting") === "1"}
          onPressedChange={(p) => set("rotting", p ? "1" : null)}
        >
          <Snowflake /> Esfriando
        </Toggle>
        <Toggle
          variant="outline"
          size="sm"
          pressed={params.get("overdue") === "1"}
          onPressedChange={(p) => set("overdue", p ? "1" : null)}
        >
          <Clock /> Atividades atrasadas
        </Toggle>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Limpar filtros
          </Button>
        ) : null}
      </div>
      {choosing ? <KanbanCompanyChooser companies={companies} view={choosing} /> : null}
    </div>
  );
}

/** Visão "Todas as empresas": Kanban e Forecast são por empresa, então pedem a empresa. */
export function KanbanCompanyChooser({ companies, view }: { companies: CompanySummary[]; view: DealView }) {
  const router = useRouter();
  const target = view === "forecast" ? "?visao=forecast" : "";
  return (
    <div className="flex max-w-md flex-col gap-3 rounded-xl border p-4">
      <p className="text-sm">
        {view === "forecast"
          ? "O forecast mostra um funil por vez. Escolha a empresa:"
          : "O kanban mostra um funil por vez. Escolha a empresa para abrir o quadro:"}
      </p>
      <CompanyPicker entity="deals" companies={companies} onSelect={(c) => router.push(`/${c.slug}/negocios${target}`)} />
    </div>
  );
}
