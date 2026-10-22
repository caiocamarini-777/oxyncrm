"use client";

import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Link "Exportar CSV" com os filtros atuais (sem a página). Use dentro de `Suspense`. */
export function ExportLink({ scopeSlug, segment }: { scopeSlug: string; segment: string }) {
  const params = useSearchParams();
  const next = new URLSearchParams(params.toString());
  next.delete("page");
  const qs = next.toString();
  return (
    <a
      href={`/${scopeSlug}/exportar/${segment}${qs ? `?${qs}` : ""}`}
      className={buttonVariants({ variant: "outline" })}
    >
      <Download /> Exportar CSV
    </a>
  );
}
