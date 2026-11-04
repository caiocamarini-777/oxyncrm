"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { unlinkEmailThread } from "@/lib/gmail/actions";
import type { ThreadLinkView } from "@/lib/gmail/live";
import { recordHref, type RecordEntity } from "@/lib/records/types";

const ENTITY_LABEL: Record<RecordEntity, string> = {
  leads: "Lead",
  deals: "Negócio",
  persons: "Pessoa",
  organizations: "Organização",
};

/** Vínculos ativos da conversa, cada um com o link para o card e o botão de desvincular. */
export function ThreadLinkChips({ links, companySlug }: { links: ThreadLinkView[]; companySlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState<string | null>(null);

  async function unlink(l: ThreadLinkView) {
    if (!window.confirm(`Desvincular a conversa de ${l.title}? Ela não volta sozinha.`)) return;
    setBusy(l.linkId);
    try {
      const res = await unlinkEmailThread(l.linkId, pathname);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Conversa desvinculada.");
      router.refresh();
    } catch {
      toast.error("Não foi possível desvincular agora. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  if (links.length === 0) return <p className="text-sm text-muted-foreground">Esta conversa ainda não está vinculada a nenhum registro.</p>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Vínculos">
      {links.map((l) => (
        <li key={l.linkId} className="flex items-center gap-1 rounded-md border bg-card py-0.5 pl-2 pr-0.5 text-sm">
          <span className="text-xs text-muted-foreground">{ENTITY_LABEL[l.entity]}</span>
          <Link href={recordHref(l.entity, companySlug, l.recordId)} className="font-medium text-primary underline-offset-2 hover:underline">
            {l.title}
          </Link>
          <button
            type="button"
            aria-label={`Desvincular de ${l.title}`}
            disabled={busy === l.linkId}
            onClick={() => void unlink(l)}
            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}
