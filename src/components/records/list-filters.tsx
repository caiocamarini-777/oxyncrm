"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecordEntity } from "@/lib/records/types";
import { MultiSelect, type MultiOption } from "./multi-select";

export type ListFilterOptions = {
  owners: MultiOption[];
  labels: MultiOption[];
  /** Só em leads. */
  statuses?: MultiOption[];
  /** Só em leads. */
  sources?: MultiOption[];
};

const FILTER_KEYS = ["q", "page", "owner", "label", "status", "source", "createdFrom", "createdTo"];

export function ListFilters({
  entity,
  options,
}: {
  entity: RecordEntity;
  options: ListFilterOptions;
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

  function setSingle(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      if (q.trim() === (params.get("q") ?? "")) return;
      setSingle("q", q.trim());
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

  return (
    <div className="flex flex-wrap items-center gap-2" data-entity={entity}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar"
          aria-label="Buscar"
          className="h-8 w-56 pl-8"
        />
      </div>
      <MultiSelect
        label="Responsável"
        options={options.owners}
        value={params.getAll("owner")}
        onChange={(v) => setMulti("owner", v)}
      />
      <MultiSelect
        label="Etiqueta"
        options={options.labels}
        value={params.getAll("label")}
        onChange={(v) => setMulti("label", v)}
      />
      {entity === "leads" && options.statuses ? (
        <MultiSelect
          label="Status"
          options={options.statuses}
          value={params.getAll("status")}
          onChange={(v) => setMulti("status", v)}
        />
      ) : null}
      {entity === "leads" && options.sources ? (
        <MultiSelect
          label="Origem"
          options={options.sources}
          value={params.getAll("source")}
          onChange={(v) => setMulti("source", v)}
        />
      ) : null}
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        Criado de
        <Input
          type="date"
          value={params.get("createdFrom") ?? ""}
          onChange={(e) => setSingle("createdFrom", e.target.value)}
          className="h-8 w-36"
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        até
        <Input
          type="date"
          value={params.get("createdTo") ?? ""}
          onChange={(e) => setSingle("createdTo", e.target.value)}
          className="h-8 w-36"
        />
      </label>
      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clear}>
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}
