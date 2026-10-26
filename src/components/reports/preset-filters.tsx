"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MultiSelect, type MultiOption } from "@/components/records/multi-select";
import { Input } from "@/components/ui/input";
import type { Preset } from "@/lib/reports/presets";

export type PresetFilterOptions = {
  company: MultiOption[];
  owner: MultiOption[];
  team: MultiOption[];
  pipeline: MultiOption[];
};

const selectCls = "h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Filtros de um relatório pronto, guardados na URL (a página roda de novo no servidor a cada mudança). */
export function PresetFilters({
  preset,
  options,
  showCompany,
}: {
  preset: Preset;
  options: PresetFilterOptions;
  showCompany: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const push = (next: URLSearchParams) => {
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  };
  const setOne = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  };
  const setMulti = (key: string, values: string[]) => {
    const next = new URLSearchParams(params.toString());
    next.delete(key);
    values.forEach((v) => next.append(key, v));
    push(next);
  };

  const has = (f: string) => preset.filters.includes(f as never);
  const pipelineParam = preset.params.find((p) => p.type === "pipeline");
  const groupParam = preset.params.find((p) => p.type === "select");

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros">
      {preset.usesPeriod ? (
        <>
          <Input
            type="date"
            aria-label="De"
            className="w-40"
            value={params.get("de") ?? ""}
            onChange={(e) => setOne("de", e.target.value)}
          />
          <Input
            type="date"
            aria-label="Até"
            className="w-40"
            value={params.get("ate") ?? ""}
            onChange={(e) => setOne("ate", e.target.value)}
          />
        </>
      ) : null}
      {pipelineParam ? (
        <select
          aria-label="Funil"
          className={selectCls}
          value={params.get("funil") ?? options.pipeline[0]?.value ?? ""}
          onChange={(e) => setOne("funil", e.target.value)}
        >
          {options.pipeline.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : has("pipeline") ? (
        <MultiSelect label="Funil" options={options.pipeline} value={params.getAll("funil")} onChange={(v) => setMulti("funil", v)} />
      ) : null}
      {groupParam ? (
        <select
          aria-label={groupParam.label}
          className={selectCls}
          value={params.get("agrupar") ?? ""}
          onChange={(e) => setOne("agrupar", e.target.value)}
        >
          <option value="">Sem agrupamento</option>
          {groupParam.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
      {showCompany && has("company") ? (
        <MultiSelect label="Empresa" options={options.company} value={params.getAll("empresa")} onChange={(v) => setMulti("empresa", v)} />
      ) : null}
      {has("owner") ? (
        <MultiSelect label="Responsável" options={options.owner} value={params.getAll("owner")} onChange={(v) => setMulti("owner", v)} />
      ) : null}
      {has("team") ? (
        <MultiSelect label="Equipe" options={options.team} value={params.getAll("team")} onChange={(v) => setMulti("team", v)} />
      ) : null}
    </div>
  );
}
