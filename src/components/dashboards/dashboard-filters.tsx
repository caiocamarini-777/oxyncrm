"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PERIOD_PRESETS, matchPeriodPreset, periodRange, type PeriodPresetKey } from "@/lib/dashboards/filters";
import type { DashboardPeriod } from "@/lib/reports/filters";
import { RELATIVE_PERIODS } from "@/lib/reports/spec";

const selectCls = "h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Relativos (resolvidos no banco a cada abertura) primeiro, como no Pipedrive; os de "últimos N dias" ficam nas
// datas fixas para não repetir rótulo. "Mês atual" fixo some: "Este mês" faz o mesmo.
const RELATIVE_OPTIONS = RELATIVE_PERIODS.filter((p) => !p.key.startsWith("last_") || p.key === "last_week" || p.key === "last_month" || p.key === "last_year");
const FIXED_OPTIONS = PERIOD_PRESETS.filter((p) => p.key !== "month");

type Option = { value: string; label: string };

/** Filtros globais do dashboard, guardados na URL (periodo ou de/ate, responsavel, funil, empresa). */
export function DashboardFilters({
  today,
  period,
  companies,
  company,
  owners = [],
  owner = "",
  pipelines = [],
  pipeline = "",
}: {
  /** Dia de hoje (AAAA-MM-DD, fuso de São Paulo). */
  today: string;
  /** Período vindo da URL e válido; nulo quando a URL não traz um. */
  period: DashboardPeriod | null;
  /** Empresas para filtrar; nulo quando o escopo é uma empresa só. */
  companies: { slug: string; name: string }[] | null;
  /** Slug da empresa escolhida na URL (válido). */
  company: string;
  /** Usuários para o filtro de responsável; vazio esconde o filtro. */
  owners?: Option[];
  owner?: string;
  /** Funis para o filtro de funil; vazio esconde o filtro. */
  pipelines?: Option[];
  pipeline?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [forceRange, setForceRange] = useState(false);
  const fixed = period && "from" in period ? period : null;
  const [from, setFrom] = useState(fixed?.from ?? "");
  const [to, setTo] = useState(fixed?.to ?? "");
  // A URL manda: quando o período dela muda (voltar, link, atalho), os campos acompanham.
  const urlKey = period ? ("relative" in period ? period.relative : `${period.from}/${period.to}`) : "";
  const [seenKey, setSeenKey] = useState(urlKey);
  if (seenKey !== urlKey) {
    setSeenKey(urlKey);
    setFrom(fixed?.from ?? "");
    setTo(fixed?.to ?? "");
    if (period) setForceRange(false);
  }

  const preset = fixed ? matchPeriodPreset(fixed, today) : null;
  const mode =
    period && "relative" in period
      ? `rel:${period.relative}`
      : preset && preset !== "month"
        ? preset
        : period || forceRange
          ? "range"
          : "";

  function push(next: URLSearchParams) {
    const s = next.toString();
    startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  }
  function setPeriod(range: { from: string; to: string } | { relative: string } | null) {
    const next = new URLSearchParams(params.toString());
    next.delete("de");
    next.delete("ate");
    next.delete("periodo");
    if (range && "relative" in range) next.set("periodo", range.relative);
    else if (range) {
      next.set("de", range.from);
      next.set("ate", range.to);
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
    } else if (value.startsWith("rel:")) {
      setForceRange(false);
      setPeriod({ relative: value.slice(4) });
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
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtros do dashboard" aria-busy={pending}>
      <select aria-label="Período" className={selectCls} value={mode} onChange={(e) => onMode(e.target.value)}>
        <option value="">Padrão do dashboard</option>
        <optgroup label="Relativo">
          {RELATIVE_OPTIONS.map((p) => (
            <option key={p.key} value={`rel:${p.key}`}>
              {p.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Datas">
          {FIXED_OPTIONS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="range">Intervalo</option>
        </optgroup>
      </select>
      {mode ? (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Limpar período" onClick={() => onMode("")}>
          <X aria-hidden />
        </Button>
      ) : null}
      {mode === "range" ? (
        <>
          <Input type="date" aria-label="De" className="w-40" value={from} onChange={(e) => onDates(e.target.value, to)} />
          <Input type="date" aria-label="Até" className="w-40" value={to} onChange={(e) => onDates(from, e.target.value)} />
        </>
      ) : null}
      {owners.length > 0 ? (
        <select aria-label="Usuário" className={selectCls} value={owner} onChange={(e) => setParam("responsavel", e.target.value)}>
          <option value="">Todos os usuários</option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
      {pipelines.length > 0 ? (
        <select aria-label="Funil" className={selectCls} value={pipeline} onChange={(e) => setParam("funil", e.target.value)}>
          <option value="">Todos os funis</option>
          {pipelines.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}
      {companies ? (
        <select aria-label="Empresa" className={selectCls} value={company} onChange={(e) => setParam("empresa", e.target.value)}>
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
