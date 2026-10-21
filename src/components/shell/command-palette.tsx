"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ALL_COMPANIES_SLUG } from "@/lib/companies/constants";
import { switchCompanyPath, type CompanySummary } from "@/lib/companies/pure";
import { NAV_ITEMS, isNavItemEnabled, navHref } from "@/lib/nav";

export function CommandPalette({
  companies,
  scopeSlug,
  allowAll,
  isSuperAdmin,
}: {
  companies: CompanySummary[];
  scopeSlug: string | null;
  allowAll: boolean;
  isSuperAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    router.push(path);
  };
  const targets = allowAll
    ? [{ id: "all", name: "Todas as empresas", slug: ALL_COMPANIES_SLUG }, ...companies]
    : companies;
  const pages = NAV_ITEMS.filter(
    (i) => isNavItemEnabled(i, isSuperAdmin) && (!i.scoped || scopeSlug),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-background px-3 text-sm text-muted-foreground hover:bg-accent"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Buscar</span>
        <kbd className="hidden rounded border px-1.5 text-xs sm:inline">Ctrl K</kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Busca" description="Ir para uma empresa ou página">
        <CommandInput placeholder="Buscar empresas e páginas" />
        <CommandList>
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          <CommandGroup heading="Empresas">
            {targets.map((c) => (
              <CommandItem key={c.id} value={`empresa ${c.name}`} onSelect={() => go(switchCompanyPath(pathname, c.slug))}>
                {c.name}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Ir para">
            {pages.map((i) => (
              <CommandItem key={i.key} value={`ir ${i.label}`} onSelect={() => go(navHref(i, scopeSlug ?? ""))}>
                <i.icon className="size-4" />
                {i.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
