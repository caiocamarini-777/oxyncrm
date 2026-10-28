"use client";

import { Ellipsis, GripVertical, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ColorContext } from "@/lib/insights/palette";
import type { InsightDefinition, InsightResult } from "@/lib/insights/types";
import { EmptyChart } from "../chart/empty-chart";
import { InsightChart } from "../chart/insight-chart";
import { EntityIcon, iconFor } from "../entity-icon";

type Props = {
  name: string;
  href?: string;
  def: InsightDefinition;
  chips: string[];
  result: InsightResult | null;
  error: string | null;
  loading: boolean;
  colors: ColorContext;
  draggable?: boolean;
  onRemove?: () => void;
  onDuplicate?: () => void;
};

/** Cartão do painel: ícone da entidade, nome (abre o relatório), chips dos filtros e o gráfico compacto. */
export function Widget({ name, href, def, chips, result, error, loading, colors, draggable, onRemove, onDuplicate }: Props) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-xs" aria-label={name}>
      <header className="flex items-start gap-1.5 px-3 pt-2.5">
        {draggable ? (
          <GripVertical className="widget-drag mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing" aria-label="Mover" />
        ) : null}
        <EntityIcon icon={iconFor(def.data_type, def.report_type)} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} className="block truncate text-sm font-semibold hover:underline" title={name}>
              {name}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold" title={name}>
              {name}
            </p>
          )}
          {chips.length ? (
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground" title={chips.join(" · ")}>
              {chips.join(" · ")}
            </p>
          ) : null}
        </div>
        {loading && result ? <Loader2 className="mt-0.5 size-3.5 animate-spin text-muted-foreground" aria-label="Atualizando" /> : null}
        {href || onRemove || onDuplicate ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="-mr-1 size-6 print:hidden" aria-label={`Ações de ${name}`}>
                <Ellipsis className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {href ? (
                <DropdownMenuItem asChild>
                  <Link href={href}>Abrir relatório</Link>
                </DropdownMenuItem>
              ) : null}
              {onDuplicate ? <DropdownMenuItem onSelect={onDuplicate}>Duplicar relatório</DropdownMenuItem> : null}
              {onRemove ? (
                <DropdownMenuItem className="text-destructive" onSelect={onRemove}>
                  Remover do painel
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 p-3 pt-2">
        {error ? (
          <EmptyChart message={error} />
        ) : result ? (
          <InsightChart def={def} result={result} colors={colors} compact />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
          </div>
        )}
      </div>
    </article>
  );
}
