"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DataTable, type RecordColumn } from "@/components/records/data-table";
import type { ActivityRow } from "@/lib/activities/queries";
import { formatDateTime, formatDue } from "@/lib/activities/time";
import { TAB_PARAM, type ActivityListFilters } from "@/lib/activities/view";
import { cn } from "cn";
import { ActivityChip, TypeIcon } from "./activity-chip";
import { CompleteHost } from "./complete-host";
import { primaryLink } from "./helpers";
import type { PageCtx } from "./page-context";

const TABS = [
  { tab: "overdue", label: "Atrasadas" },
  { tab: "today", label: "Hoje" },
  { tab: "upcoming", label: "Próximas" },
  { tab: "done", label: "Concluídas" },
] as const;

const EMPTY: Record<ActivityListFilters["tab"], string> = {
  overdue: "Nenhuma atividade atrasada.",
  today: "Nenhuma atividade para hoje.",
  upcoming: "Nenhuma atividade próxima.",
  done: "Nenhuma atividade concluída.",
};

function ActivityTabs({ active, overdueCount }: { active: ActivityListFilters["tab"]; overdueCount: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <nav aria-label="Abas de atividades" className="flex gap-1 border-b">
      {TABS.map((t) => {
        const next = new URLSearchParams(params.toString());
        next.delete("page");
        next.set("aba", TAB_PARAM[t.tab]);
        return (
          <Link
            key={t.tab}
            href={`${pathname}?${next.toString()}`}
            aria-current={active === t.tab ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active === t.tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.tab === "overdue" && overdueCount > 0 ? (
              <span
                data-testid="overdue-count"
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white"
              >
                {overdueCount}
                <span className="sr-only"> atrasadas</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Lista por abas (atrasadas, hoje, próximas, concluídas) com colunas ordenáveis e o círculo de concluir. */
export function ActivityList({
  rows,
  total,
  query,
  ctx,
  overdueCount,
  filtered,
  scopeSlug,
}: {
  rows: ActivityRow[];
  total: number;
  query: ActivityListFilters;
  ctx: PageCtx;
  overdueCount: number;
  filtered: boolean;
  scopeSlug: string;
}) {
  const [completing, setCompleting] = useState<ActivityRow | null>(null);
  const now = new Date(ctx.nowIso);

  const columns = useMemo<RecordColumn<ActivityRow>[]>(
    () => [
      {
        id: "complete",
        header: "Concluir",
        cell: (a) => {
          const canEdit = ctx.companies.find((c) => c.id === a.companyId)?.canEdit ?? false;
          if (a.done) return <Check aria-label="Concluída" className="size-4 text-primary" />;
          if (!canEdit) return null;
          return (
            <button
              type="button"
              aria-label={`Concluir ${a.subject}`}
              title="Concluir"
              onClick={() => setCompleting(a)}
              className="flex size-7 items-center justify-center rounded-full border-2 border-input text-transparent transition-colors hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-none"
            >
              <Check aria-hidden className="size-4" />
            </button>
          );
        },
      },
      {
        id: "type",
        header: "Tipo",
        cell: (a) => (
          <span className="inline-flex items-center gap-1.5">
            <TypeIcon name={a.type.name} isMeeting={a.type.isMeeting} className="text-muted-foreground" />
            {a.type.name}
          </span>
        ),
      },
      {
        id: "subject",
        header: "Assunto",
        sortKey: "subject",
        cell: (a) => <span className={cn("font-medium", a.done && "text-muted-foreground line-through")}>{a.subject}</span>,
      },
      {
        id: "link",
        header: "Vínculo",
        cell: (a) => {
          const l = primaryLink(a);
          return l ? (
            <Link href={l.href} className="text-primary hover:underline">
              {l.label}
            </Link>
          ) : (
            <span className="text-muted-foreground">Sem vínculo visível</span>
          );
        },
      },
      { id: "channel", header: "Canal", cell: (a) => a.channel.name },
      {
        id: "due",
        header: "Data",
        sortKey: "due_at",
        cell: (a) =>
          a.done ? (
            <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.dueAt)}</span>
          ) : (
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              {formatDue(a.dueAt, now)}
              <ActivityChip status={a.status} />
            </span>
          ),
      },
      { id: "owner", header: "Responsável", cell: (a) => a.ownerName },
      { id: "company", header: "Empresa", companyOnly: true, cell: (a) => a.companyName },
    ],
    // `now` deriva de ctx.nowIso
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx],
  );

  return (
    <div className="flex flex-col gap-3">
      <ActivityTabs active={query.tab} overdueCount={overdueCount} />
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed py-16 text-center" data-testid="activities-empty">
          <p className="text-sm text-muted-foreground">
            {filtered ? "Nenhuma atividade encontrada com esses filtros." : EMPTY[query.tab]}
          </p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          total={total}
          query={query}
          entity="activities"
          companyColumn={ctx.allCompanies}
          rowHref={(a) => primaryLink(a)?.href ?? `/${scopeSlug}/atividades`}
        />
      )}
      <CompleteHost activity={completing} ctx={ctx} onClose={() => setCompleting(null)} />
    </div>
  );
}
