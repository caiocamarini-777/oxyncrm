"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { linkThreadToRecord, searchLinkTargets, type LinkTarget } from "@/lib/gmail/link-actions";
import type { RecordEntity } from "@/lib/records/types";

const ENTITY_LABEL: Record<RecordEntity, string> = {
  leads: "Lead",
  deals: "Negócio",
  persons: "Pessoa",
  organizations: "Organização",
};

/** "Vincular a…": busca lead, negócio, pessoa ou organização da empresa da caixa e vincula a conversa. */
export function LinkThreadDialog({
  accountId,
  companyId,
  gmailThreadId,
}: {
  accountId: string;
  companyId: string;
  gmailThreadId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  // Resultado da última busca concluída, com o termo a que pertence (resultado de outro termo é ignorado).
  const [found, setFound] = useState<{ term: string; items: LinkTarget[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const trimmed = term.trim();
  const searched = trimmed.length >= 2;
  const current = searched && found?.term === trimmed ? found.items : null;

  useEffect(() => {
    if (!open || !searched) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await searchLinkTargets(companyId, trimmed).catch(() => null);
      if (!cancelled) setFound({ term: trimmed, items: res?.ok ? res.data : [] });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [trimmed, searched, open, companyId]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setTerm("");
      setFound(null);
    }
  }

  async function pick(target: LinkTarget) {
    setBusyId(`${target.entity}:${target.id}`);
    try {
      const res = await linkThreadToRecord(accountId, gmailThreadId, target.entity, target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Conversa vinculada a ${target.title}.`);
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Não foi possível vincular agora. Tente novamente.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link2 /> Vincular a…
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular conversa</DialogTitle>
            <DialogDescription>
              Busque um lead, negócio, pessoa ou organização. A conversa inteira é salva no CRM e as respostas seguintes entram sozinhas.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nome, título, e-mail ou domínio"
            aria-label="Buscar registro"
          />
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto" aria-label="Resultados">
            {(current ?? []).map((r) => {
              const key = `${r.entity}:${r.id}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={busyId !== null}
                    onClick={() => void pick(r)}
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.title}</span>
                      {r.subtitle ? <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span> : null}
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {busyId === key ? "Vinculando…" : ENTITY_LABEL[r.entity]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {current && current.length === 0 ? <p className="text-sm text-muted-foreground">Nada encontrado nesta empresa.</p> : null}
          {searched && !current ? <p className="text-sm text-muted-foreground">Buscando…</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
