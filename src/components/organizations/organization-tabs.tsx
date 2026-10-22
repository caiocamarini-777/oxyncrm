import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function DisabledTab({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="tab"
          tabIndex={0}
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

/**
 * Centro do detalhe. A Task 8 passa `notes` (anotações) e `timeline` (linha do tempo);
 * até lá ficam os espaços reservados.
 */
export function OrganizationTabs({ notes, timeline }: { notes?: ReactNode; timeline?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Registro" className="flex gap-1 border-b">
        <span
          role="tab"
          aria-selected="true"
          className="-mb-px border-b-2 border-primary px-3 py-2 text-sm font-medium"
        >
          Anotação
        </span>
        <DisabledTab label="Atividade" />
        <DisabledTab label="E-mail" />
      </div>
      <div role="tabpanel" data-testid="notes-area">
        {notes ?? <p className="text-sm text-muted-foreground">As anotações aparecem aqui.</p>}
      </div>
      <section aria-label="Linha do tempo" data-testid="timeline-area">
        <h2 className="mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Linha do tempo
        </h2>
        {timeline ?? <p className="text-sm text-muted-foreground">O histórico do registro aparece aqui.</p>}
      </section>
    </div>
  );
}
