"use client";

import { useEffect, useRef, useState } from "react";
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
import { switchCompanyPath, type CompanyScope, type CompanySummary } from "@/lib/companies/pure";
import { NAV_ITEMS, PALETTE_EXTRA_ITEMS, isNavItemEnabled, navHref } from "@/lib/nav";
import { searchRecords, type SearchResult } from "@/lib/search/actions";

const GROUPS = [
  { entity: "leads", heading: "Leads" },
  { entity: "persons", heading: "Pessoas" },
  { entity: "organizations", heading: "Organizações" },
] as const;

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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const requestId = useRef(0);
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

  useEffect(() => {
    const id = ++requestId.current;
    const q = query.trim();
    if (q.length < 2) return;
    const scope: CompanyScope = (() => {
      const company = companies.find((c) => c.slug === scopeSlug);
      return company ? { kind: "company", company } : { kind: "all" };
    })();
    const timer = setTimeout(async () => {
      try {
        const found = await searchRecords(q, scope);
        if (id === requestId.current) setResults(found);
      } catch {
        if (id === requestId.current) setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, companies, scopeSlug]);

  const go = (path: string) => {
    setOpen(false);
    router.push(path);
  };
  const targets = allowAll
    ? [{ id: "all", name: "Todas as empresas", slug: ALL_COMPANIES_SLUG }, ...companies]
    : companies;
  const pages = [...NAV_ITEMS, ...PALETTE_EXTRA_ITEMS].filter(
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
      <CommandDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            requestId.current++;
            setQuery("");
            setResults([]);
          }
        }} title="Busca" description="Ir para um registro, empresa ou página"
      >
        <CommandInput
          placeholder="Buscar empresas, registros e páginas"
          value={query}
          onValueChange={(v) => {
            setQuery(v);
            if (v.trim().length < 2) {
              requestId.current++;
              setResults([]);
            }
          }}
        />
        <CommandList>
          <CommandEmpty>Nada encontrado.</CommandEmpty>
          {GROUPS.map((g) => {
            const items = results.filter((r) => r.entity === g.entity);
            if (items.length === 0) return null;
            return (
              <CommandGroup key={g.entity} heading={g.heading}>
                {items.map((r) => (
                  // O valor inclui o texto digitado para o filtro do cmdk não esconder achados por e-mail.
                  <CommandItem key={r.id} value={`${query} ${r.title} ${r.id}`} onSelect={() => go(r.href)}>
                    <span className="truncate">{r.title}</span>
                    {r.subtitle ? <span className="truncate text-xs text-muted-foreground">{r.subtitle}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
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
