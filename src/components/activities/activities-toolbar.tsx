"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect, type MultiOption } from "@/components/records/multi-select";
import { VIEWS, type ActivityView } from "@/lib/activities/view";
import { cn } from "cn";
import { NewActivityDialog } from "./new-activity-dialog";
import type { PageCtx } from "./page-context";

export type ActivityFilterOptions = {
  owners: MultiOption[];
  teams: MultiOption[];
  types: MultiOption[];
  channels: MultiOption[];
};

const VIEW_LABEL: Record<ActivityView, string> = { lista: "Lista", semana: "Semana", mes: "Mês" };
const FILTER_KEYS = ["q", "page", "owner", "team", "type", "channel"];

/** Visões (lista, semana, mês), filtros na URL e "Nova atividade". */
export function ActivitiesToolbar({
  view,
  options,
  ctx,
}: {
  view: ActivityView;
  options: ActivityFilterOptions;
  ctx: PageCtx;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const first = useRef(true);

  function push(next: URLSearchParams) {
    next.delete("page");
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
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
      const next = new URLSearchParams(params.toString());
      if (q.trim()) next.set("q", q.trim());
      else next.delete("q");
      push(next);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = FILTER_KEYS.filter((k) => k !== "page").some((k) => params.has(k));
  function clear() {
    const next = new URLSearchParams(params.toString());
    FILTER_KEYS.forEach((k) => next.delete(k));
    setQ("");
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }

  function viewHref(v: ActivityView) {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    next.delete("sort");
    next.delete("dir");
    if (v === "lista") next.delete("visao");
    else next.set("visao", v);
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Visão" className="flex rounded-md border p-0.5">
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={viewHref(v)}
              aria-current={view === v ? "page" : undefined}
              className={cn(
                "rounded px-2.5 py-1 text-sm font-medium transition-colors",
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </nav>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar"
            aria-label="Buscar"
            className="h-8 w-48 pl-8"
          />
        </div>
        <MultiSelect label="Tipo" options={options.types} value={params.getAll("type")} onChange={(v) => setMulti("type", v)} />
        <MultiSelect label="Canal" options={options.channels} value={params.getAll("channel")} onChange={(v) => setMulti("channel", v)} />
        <MultiSelect label="Responsável" options={options.owners} value={params.getAll("owner")} onChange={(v) => setMulti("owner", v)} />
        <MultiSelect label="Equipe" options={options.teams} value={params.getAll("team")} onChange={(v) => setMulti("team", v)} />
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Limpar filtros
          </Button>
        ) : null}
      </div>
      <NewActivityDialog ctx={ctx} />
    </div>
  );
}
