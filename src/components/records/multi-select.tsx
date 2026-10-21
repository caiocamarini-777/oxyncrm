"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type MultiOption = { value: string; label: string };

export function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label}>
          {label}
          {value.length > 0 ? (
            <span className="rounded bg-primary/15 px-1 text-xs text-primary">{value.length}</span>
          ) : null}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
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
