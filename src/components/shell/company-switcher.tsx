"use client";

import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ALL_COMPANIES_SLUG } from "@/lib/companies/constants";
import { switchCompanyPath, type CompanySummary } from "@/lib/companies/pure";

export function CompanySwitcher({
  companies,
  scopeSlug,
  allowAll,
}: {
  companies: CompanySummary[];
  scopeSlug: string | null;
  allowAll: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const label = !scopeSlug
    ? "Nenhuma empresa"
    : scopeSlug === ALL_COMPANIES_SLUG
      ? "Todas as empresas"
      : (companies.find((c) => c.slug === scopeSlug)?.name ?? scopeSlug);
  const go = (slug: string) => router.push(switchCompanyPath(pathname, slug));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="Trocar de empresa" className="gap-2">
          <span className="max-w-40 truncate">{label}</span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {allowAll ? (
          <>
            <DropdownMenuItem onSelect={() => go(ALL_COMPANIES_SLUG)}>
              Todas as empresas
              {scopeSlug === ALL_COMPANIES_SLUG ? <Check className="ml-auto size-4" /> : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {companies.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => go(c.slug)}>
            {c.name}
            {c.slug === scopeSlug ? <Check className="ml-auto size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
