"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type MultiOption = { value: string; label: string };

/** Texto do filtro de etiquetas: o registro precisa ter todas as etiquetas escolhidas. */
export const LABEL_FILTER = { label: "Etiquetas (todas)", hint: "Mostra registros com todas as etiquetas escolhidas" };

export function MultiSelect({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  /** Dica ao passar o mouse ou focar o botão. */
  hint?: string;
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const trigger = (
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" aria-label={label}>
        {label}
        {value.length > 0 ? (
          <span className="rounded bg-primary/15 px-1 text-xs text-primary">{value.length}</span>
        ) : null}
        <ChevronDown />
      </Button>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {hint ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {options.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Nenhuma opção.</p>
        ) : (
          options.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={value.includes(o.value)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) =>
                onChange(on === true ? [...value, o.value] : value.filter((v) => v !== o.value))
              }
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
