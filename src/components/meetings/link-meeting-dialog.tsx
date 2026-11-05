"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CompanyScope } from "@/lib/companies/pure";
import { isLinkEntity, type LinkEntity } from "@/lib/meet/decisions";
import { linkMeeting } from "@/lib/meet/actions";
import { searchRecords, type SearchResult } from "@/lib/search/actions";

/** A reunião a vincular. A empresa limita a busca: o registro precisa ser da mesma empresa da reunião. */
export type LinkMeetingTarget = {
  id: string;
  title: string;
  companyId: string;
  companyName: string;
  companySlug: string;
};

const GROUPS: { entity: LinkEntity; heading: string }[] = [
  { entity: "deals", heading: "Negócios" },
  { entity: "leads", heading: "Leads" },
  { entity: "persons", heading: "Pessoas" },
];

type Picked = { entity: LinkEntity; id: string; title: string };

/**
 * Vincula uma reunião sem vínculo a um negócio, lead ou pessoa da empresa dela. Usa a mesma busca da paleta de
 * comandos (`searchRecords`), sem organizações: o assistente nunca cria registro, só liga a um que já existe.
 * Reaproveitado pela tela inicial.
 */
export function LinkMeetingDialog({
  meeting,
  open,
  onOpenChange,
}: {
  meeting: LinkMeetingTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const q = query.trim();
    if (!open || q.length < 2) return;
    const scope: CompanyScope = {
      kind: "company",
      company: { id: meeting.companyId, name: meeting.companyName, slug: meeting.companySlug, logoUrl: null },
    };
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchRecords(q, scope);
        if (id === requestId.current) setResults(found);
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [open, query, meeting.companyId, meeting.companyName, meeting.companySlug]);

  function reset() {
    requestId.current++;
    setQuery("");
    setResults([]);
    setSearching(false);
    setPicked(null);
  }

  function change(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function confirm() {
    if (!picked) return;
    const target = picked;
    start(async () => {
      const res = await linkMeeting(meeting.id, target.entity, target.id);
      if (!res.ok) {
        // Fica aberto: o motivo pode ser o registro escolhido (excluído, sem id no Pipedrive), e dá para escolher outro.
        toast.error(res.error);
        router.refresh();
        return;
      }
      toast.success("Reunião vinculada.");
      change(false);
      router.refresh();
    });
  }

  const shown = query.trim().length < 2 ? [] : results;

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vincular reunião</DialogTitle>
          <DialogDescription>
            Escolha o negócio, lead ou pessoa de {meeting.companyName || "a empresa"} que recebe a reunião “{meeting.title}”.
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="rounded-lg border">
          <CommandInput
            placeholder="Buscar negócio, lead ou pessoa"
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setPicked(null);
              if (v.trim().length < 2) {
                requestId.current++;
                setResults([]);
                setSearching(false);
              }
            }}
          />
          <CommandList>
            <CommandEmpty>
              {query.trim().length < 2 ? "Digite ao menos 2 letras." : searching ? "Buscando…" : "Nada encontrado."}
            </CommandEmpty>
            {GROUPS.map((g) => {
              const items = shown.filter((r) => r.entity === g.entity);
              if (items.length === 0) return null;
              return (
                <CommandGroup key={g.entity} heading={g.heading}>
                  {items.map((r) => (
                    <CommandItem
                      key={`${r.entity}:${r.id}`}
                      // O valor inclui o texto digitado, como na paleta, para o cmdk não esconder achados por e-mail.
                      value={`${query} ${r.title} ${r.id}`}
                      data-checked={picked?.id === r.id}
                      onSelect={() => isLinkEntity(r.entity) && setPicked({ entity: r.entity, id: r.id, title: r.title })}
                    >
                      <span className="truncate">{r.title}</span>
                      {r.subtitle ? <span className="truncate text-xs text-muted-foreground">{r.subtitle}</span> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
        <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
          {picked ? `Selecionado: ${picked.title}` : "Nenhum registro selecionado."}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => change(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={!picked || pending}>
            {pending ? "Vinculando…" : "Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
