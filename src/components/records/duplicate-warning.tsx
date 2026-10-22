"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MATCH_LABELS, type DuplicateMatch } from "@/lib/records/duplicates";

/**
 * Aviso de duplicidade. Mostra apenas o campo coincidente e o responsável; "Abrir" só aparece
 * quando o banco devolveu `recordId` (usuário com permissão de leitura). Não bloqueia o salvamento.
 */
export function DuplicateWarning({
  matches,
  subject,
  hrefFor,
}: {
  matches: DuplicateMatch[];
  /** Ex.: "uma organização", "uma pessoa". */
  subject: string;
  hrefFor: (id: string) => string;
}) {
  if (matches.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md border border-primary/40 bg-primary/5 p-2 text-sm">
      {matches.map((m, i) => (
        <p key={`${m.matchedOn}-${m.recordId ?? i}-${i}`} data-testid="duplicate-warning">
          Já existe {subject} com este{" "}
          {MATCH_LABELS[m.matchedOn] ?? m.matchedOn} nesta empresa. Responsável: {m.ownerName}.{" "}
          {m.recordId ? (
            <Link href={hrefFor(m.recordId)} className="font-medium text-primary underline">
              Abrir
            </Link>
          ) : null}
        </p>
      ))}
    </div>
  );
}

/** Roda `check` 400 ms depois da última mudança de `key`; `check` pode devolver [] sem ir ao servidor. */
export function useDuplicateMatches(key: string, check: () => Promise<DuplicateMatch[]>): DuplicateMatch[] {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const found = await check();
      if (!cancelled) setMatches(found);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // `check` muda a cada render; `key` resume as entradas relevantes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return matches;
}
