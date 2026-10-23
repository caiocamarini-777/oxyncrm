"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PERIOD_PRESETS, matchPeriodPreset, periodRange, type PeriodPresetKey } from "@/lib/dashboards/filters";

const selectCls = "h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Filtros globais do dashboard, guardados na URL (de, ate, empresa). */
export function DashboardFilters({
  today,
  period,
  companies,
  company,
}: {
  /** Dia de hoje (AAAA-MM-DD, fuso de São Paulo). */
  today: string;
  /** Período vindo da URL e válido; nulo quando a URL não traz um. */
  period: { from: string; to: string } | null;
  /** Empresas para filtrar; nulo quando o escopo é uma empresa só. */
  companies: { slug: string; name: string }[] | null;
  /** Slug da empresa escolhida na URL (válido). */
  company: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [forceRange, setForceRange] = useState(false);
  const [from, setFrom] = useState(period?.from ?? "");
  const [to, setTo] = useState(period?.to ?? "");

  const preset = period ? matchPeriodPreset(period, today) : null;
  const mode = preset ?? (period || forceRange ? "range" : "");

  function push(next: URLSearchParams) {
    const s = next.toString();
    startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }
  function setPeriod(range: { from: string; to: string } | null) {
    const next = new URLSearchParams(params.toString());
    if (range) {
      next.set("de", range.from);
      next.set("ate", range.to);
    } else {
      next.delete("de");
      next.delete("ate");
    }
    push(next);
  }
  function onMode(value: string) {
    if (value === "") {
      setForceRange(false);
      setFrom("");
      setTo("");
      setPeriod(null);
    } else if (value === "range") {
      setForceRange(true);
    } else {
      setForceRange(false);
      const r = periodRange(value as PeriodPresetKey, today);
      setFrom(r.from);
      setTo(r.to);
      setPeriod(r);
    }
  }
  function onDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (DAY.test(nextFrom) && DAY.test(nextTo) && nextFrom <= nextTo) setPeriod({ from: nextFrom, to: nextTo });
  }
  function onCompany(slug: string) {
    const next = new URLSearchParams(params.toString());
    if (slug) next.set("empresa", slug);
    else next.delete("empresa");
    push(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros do dashboard" aria-busy={pending}>
      <select aria-label="Período" className={selectCls} value={mode} onChange={(e) => onMode(e.target.value)}>
        <option value="">Padrão do dashboard</option>
        {PERIOD_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="range">Intervalo</option>
      </select>
      {mode === "range" ? (
        <>
          <Input type="date" aria-label="De" className="w-40" value={from} onChange={(e) => onDates(e.target.value, to)} />
          <Input type="date" aria-label="Até" className="w-40" value={to} onChange={(e) => onDates(from, e.target.value)} />
        </>
      ) : null}
      {companies ? (
        <select aria-label="Empresa" className={selectCls} value={company} onChange={(e) => onCompany(e.target.value)}>
          <option value="">Todas as empresas</option>
          {companies.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
