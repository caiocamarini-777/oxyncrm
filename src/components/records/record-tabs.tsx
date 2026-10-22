"use client";

import { useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";

function DisabledTab({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="tab"
          tabIndex={-1}
          aria-disabled="true"
          aria-label={label}
          className="-mb-px cursor-not-allowed border-b-2 border-transparent px-3 py-2 text-sm font-medium opacity-40"
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>Disponível em breve</TooltipContent>
    </Tooltip>
  );
}

type TabKey = "notes" | "activity";

/**
 * Centro do detalhe: abas Anotação e Atividade (esta só aparece com `activity`) e a linha do tempo.
 * Os dois painéis ficam montados para não perder o que o usuário digitou ao trocar de aba.
 */
export function RecordTabs({
  notes,
  activity,
  timeline,
}: {
  notes?: ReactNode;
  activity?: ReactNode;
  timeline?: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("notes");
  const tabs: { key: TabKey; label: string }[] = [
    { key: "notes", label: "Anotação" },
    ...(activity ? [{ key: "activity" as const, label: "Atividade" }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Registro" className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`record-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`record-panel-${t.key}`}
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.key ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
        {activity ? null : <DisabledTab label="Atividade" />}
        <DisabledTab label="E-mail" />
      </div>
      <div
        role="tabpanel"
        id="record-panel-notes"
        hidden={tab !== "notes"}
        data-testid="notes-area"
      >
        {notes ?? <p className="text-sm text-muted-foreground">As anotações aparecem aqui.</p>}
      </div>
      {activity ? (
        <div
          role="tabpanel"
          id="record-panel-activity"
          hidden={tab !== "activity"}
          data-testid="activity-area"
        >
          {activity}
        </div>
      ) : null}
      <section aria-label="Linha do tempo" data-testid="timeline-area">
        <h2 className="mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Linha do tempo
        </h2>
        {timeline ?? <p className="text-sm text-muted-foreground">O histórico do registro aparece aqui.</p>}
      </section>
    </div>
  );
}
