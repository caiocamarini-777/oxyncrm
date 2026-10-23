"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { shiftAnchor } from "@/lib/activities/view";

/** Anterior, Hoje e Próxima: só trocam `?data=`, mantendo visão e filtros. */
export function AgendaNav({ view, anchor, label }: { view: "semana" | "mes"; anchor: string; label: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (data: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (data) next.set("data", data);
    else next.delete("data");
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={href(shiftAnchor(anchor, view, -1))} className={buttonVariants({ variant: "outline", size: "sm" })}>
        <ChevronLeft aria-hidden /> Anterior
      </Link>
      <Link href={href(null)} className={buttonVariants({ variant: "outline", size: "sm" })}>
        Hoje
      </Link>
      <Link href={href(shiftAnchor(anchor, view, 1))} className={buttonVariants({ variant: "outline", size: "sm" })}>
        Próxima <ChevronRight aria-hidden />
      </Link>
      <h2 className="font-heading text-lg font-semibold capitalize" aria-live="polite" data-testid="agenda-title">
        {label}
      </h2>
    </div>
  );
}

export function TruncatedNotice() {
  return (
    <p role="status" data-testid="agenda-truncated" className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      A agenda mostra só as primeiras atividades do período. Use os filtros para ver as demais.
    </p>
  );
}
