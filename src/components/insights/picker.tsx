"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PickerOption = { id: string; label: string; group?: string; inactive?: boolean };

type Props = {
  options?: PickerOption[];
  /** busca no servidor (organizações, pessoas...): substitui a lista fixa */
  search?: (q: string) => Promise<PickerOption[]>;
  value: string[];
  multi?: boolean;
  onChange: (ids: string[], picked: PickerOption[]) => void;
  placeholder?: string;
  /** rótulos conhecidos dos valores escolhidos (quando a busca ainda não trouxe) */
  labels?: Record<string, string>;
  className?: string;
  ariaLabel?: string;
  align?: "start" | "end";
  /** texto do botão em vez dos valores escolhidos */
  triggerLabel?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
  /** botão só com ícone */
  icon?: React.ReactNode;
};

/** Seletor com busca (um ou vários valores), como os menus do editor de relatório do Pipedrive. */
export function Picker({
  options,
  search,
  value,
  multi = false,
  onChange,
  placeholder = "Selecionar",
  labels,
  className,
  ariaLabel,
  align = "start",
  triggerLabel,
  variant = "outline",
  size = "sm",
  icon,
}: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<PickerOption[]>([]);
  const [known, setKnown] = useState<Record<string, string>>(labels ?? {});

  useEffect(() => {
    if (!open || !search) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await search(q).catch(() => []);
      if (!cancelled) setFound(r);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, search]);

  const list = search ? found : (options ?? []);
  const name = (id: string) => known[id] ?? options?.find((o) => o.id === id)?.label ?? labels?.[id] ?? "…";
  const shown =
    triggerLabel ??
    (value.length === 0 ? placeholder : multi && value.length > 1 ? `${name(value[0]!)} +${value.length - 1}` : name(value[0]!));

  const groups = new Map<string, PickerOption[]>();
  for (const o of list) {
    const g = o.group ?? "";
    groups.set(g, [...(groups.get(g) ?? []), o]);
  }

  function toggle(o: PickerOption) {
    setKnown((k) => ({ ...k, [o.id]: o.label }));
    if (!multi) {
      onChange([o.id], [o]);
      setOpen(false);
      return;
    }
    const next = value.includes(o.id) ? value.filter((v) => v !== o.id) : [...value, o.id];
    onChange(next, next.map((id) => list.find((x) => x.id === id) ?? { id, label: name(id) }));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size={size}
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={cn("max-w-64 justify-between gap-1 font-normal", value.length === 0 && !triggerLabel && "text-muted-foreground", className)}
        >
          {icon ?? (
            <>
              <span className="truncate">{shown}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-60" />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align={align}>
        <Command shouldFilter={!search}>
          <CommandInput placeholder="Buscar" value={q} onValueChange={setQ} />
          <CommandList className="max-h-72">
            <CommandEmpty>{search && q.length === 0 ? "Digite para buscar." : "Nada encontrado."}</CommandEmpty>
            {[...groups.entries()].map(([g, opts]) => (
              <CommandGroup key={g || "_"} heading={g || undefined}>
                {opts.map((o) => (
                  <CommandItem key={o.id} value={`${o.label} ${o.id}`} onSelect={() => toggle(o)}>
                    <Check className={cn("size-4", value.includes(o.id) ? "opacity-100" : "opacity-0")} />
                    <span className={cn("truncate", o.inactive && "text-muted-foreground")}>{o.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
