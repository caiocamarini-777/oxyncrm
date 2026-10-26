"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { COUNTER_KEYS, COUNTER_LABELS, ENTITY_LABELS } from "@/lib/import/wizard";

type Counters = Record<string, Record<string, number>>;
export type LogEntry = { entity: string; external_id: string | null; reason: string };

const ENTITY_ORDER = ["job", "custom_fields", "products", "organizations", "persons", "leads", "deals", "activities", "notes"];

/** Contadores por entidade (criados, atualizados, sem mudança, ignorados, erros, avisos). */
export function CountersTable({ counters }: { counters: Counters }) {
  const entities = [
    ...ENTITY_ORDER.filter((e) => ["organizations", "persons", "leads", "deals", "activities", "notes"].includes(e) || counters[e]),
    ...Object.keys(counters).filter((e) => !ENTITY_ORDER.includes(e)),
  ];
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Entidade</th>
            {COUNTER_KEYS.map((k) => (
              <th key={k} className="px-3 py-2 text-right font-medium">
                {COUNTER_LABELS[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entities.map((e) => (
            <tr key={e} className="border-t">
              <td className="px-3 py-2">{ENTITY_LABELS[e] ?? e}</td>
              {COUNTER_KEYS.map((k) => {
                const n = Number(counters[e]?.[k] ?? 0);
                return (
                  <td
                    key={k}
                    data-testid={`counter-${e}-${k}`}
                    className={`px-3 py-2 text-right tabular-nums ${n > 0 && k === "errors" ? "font-medium text-destructive" : ""}`}
                  >
                    {n}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const PAGE = 20;

/** Lista paginada de erros ou avisos do log da importação. */
export function LogList({ items, title, emptyText, testId, total }: { items: LogEntry[]; title: string; emptyText: string; testId: string; total?: number }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const current = Math.min(page, pages - 1);
  const slice = items.slice(current * PAGE, current * PAGE + PAGE);
  const hidden = (total ?? items.length) - items.length;
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="font-heading text-base font-semibold">
        {title} <span className="text-sm font-normal text-muted-foreground">({total ?? items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <ul data-testid={testId} className="divide-y rounded-md border text-sm">
            {slice.map((item, i) => (
              <li key={`${current}-${i}`} className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-medium">{ENTITY_LABELS[item.entity] ?? item.entity}</span>
                {item.external_id && <span className="text-muted-foreground">id {item.external_id}</span>}
                <span className="min-w-0 flex-1 break-words">{item.reason.replace(/^aviso:\s*/, "")}</span>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <Button type="button" variant="outline" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
                Anterior
              </Button>
              <span className="text-muted-foreground">
                Página {current + 1} de {pages}
              </span>
              <Button type="button" variant="outline" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                Próxima
              </Button>
            </div>
          )}
          {hidden > 0 && <p className="text-xs text-muted-foreground">Mais {hidden} itens não guardados no log (o limite é 1000).</p>}
        </>
      )}
    </section>
  );
}
