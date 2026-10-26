"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import type { ForecastBucket } from "@/lib/deals/forecast";
import type { ForecastRow } from "@/lib/deals/queries";
import { formatMoney } from "@/lib/records/format";
import { recordHref } from "@/lib/records/types";
import { DealCardBody } from "./deal-card";

/** Forecast: negócios abertos por mês previsto de fechamento; cards sem arraste. */
export function ForecastView({
  buckets,
  companySlug,
  weighted,
  truncated,
  limit,
  lastMonthLabel,
}: {
  buckets: ForecastBucket<ForecastRow>[];
  companySlug: string;
  weighted: boolean;
  truncated: boolean;
  limit: number;
  /** Último mês exibido (ex.: "mar/2027"). */
  lastMonthLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setWeighted(on: boolean) {
    const next = new URLSearchParams(params.toString());
    if (on) next.set("ponderado", "1");
    else next.delete("ponderado");
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={weighted} onCheckedChange={setWeighted} aria-label="Ponderar pela probabilidade" />
          Ponderar pela probabilidade
        </label>
      </div>
      {truncated ? (
        <p role="status" className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          A previsão mostra apenas os primeiros {limit} negócios abertos; os totais podem estar incompletos. Use os filtros para refinar.
        </p>
      ) : null}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {buckets.map((b) => (
          <section
            key={b.key}
            aria-label={b.label}
            data-testid="forecast-column"
            data-bucket={b.key}
            className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/50"
          >
            <header className="flex flex-col gap-0.5 border-b px-3 py-2.5">
              <h2 className="font-heading text-sm font-semibold">{b.label}</h2>
              <p className="text-xs text-muted-foreground">
                <span data-testid="forecast-count">{b.count}</span> {b.count === 1 ? "negócio" : "negócios"}
              </p>
              <p className="text-sm font-semibold tabular-nums" data-testid="forecast-total">
                {formatMoney(b.total)}
              </p>
              {weighted ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Ponderado: <span data-testid="forecast-weighted">{formatMoney(b.weighted)}</span>
                </p>
              ) : null}
            </header>
            <ul className="flex flex-col gap-2 p-2">
              {b.deals.map((d) => (
                <li key={d.id} className="list-none" data-testid="forecast-card">
                  <DealCardBody deal={d} field="total" href={recordHref("deals", companySlug, d.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Negócios com fechamento depois de {lastMonthLabel} não aparecem aqui.
      </p>
    </div>
  );
}
