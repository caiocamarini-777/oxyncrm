"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { PAGE_SIZE } from "@/lib/records/types";

export function paginationRange(total: number, page: number): { from: number; to: number; pages: number } {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total === 0) return { from: 0, to: 0, pages };
  const from = (page - 1) * PAGE_SIZE + 1;
  return { from, to: Math.min(page * PAGE_SIZE, total), pages };
}

export function Pagination({ total, page }: { total: number; page: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { from, to, pages } = paginationRange(total, page);

  function href(p: number) {
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  }

  const base = cn(buttonVariants({ variant: "outline", size: "icon-sm" }));
  const off = "pointer-events-none opacity-50";
  return (
    <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
      <span>
        {from} a {to} de {total}
      </span>
      <div className="flex gap-1">
        <Link
          href={href(page - 1)}
          aria-label="Página anterior"
          aria-disabled={page <= 1}
          className={cn(base, page <= 1 && off)}
        >
          <ChevronLeft />
        </Link>
        <Link
          href={href(page + 1)}
          aria-label="Próxima página"
          aria-disabled={page >= pages}
          className={cn(base, page >= pages && off)}
        >
          <ChevronRight />
        </Link>
      </div>
    </div>
  );
}
