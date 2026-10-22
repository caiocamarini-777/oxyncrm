"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { archiveLead, disqualifyLead, reopenLead } from "@/lib/leads/actions";

const STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  converted: "Convertido",
  disqualified: "Desqualificado",
  archived: "Arquivado",
};

export function LeadActions({
  leadId,
  status,
  reasons,
  canEdit,
}: {
  leadId: string;
  status: string;
  reasons: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => ReturnType<typeof archiveLead>, success: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.fieldErrors?.reasonId ?? res.error);
        if (!open) toast.error(res.error);
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setReasonId("");
      setNote("");
      setError(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary" data-testid="lead-status">
        {STATUS_LABEL[status] ?? status}
      </Badge>
      {canEdit ? (
        <>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button type="button" disabled aria-disabled>
                    Converter em negócio
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Disponível com o funil de negócios</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {status === "open" ? (
            <Button type="button" variant="outline" onClick={() => setOpen(true)}>
              Desqualificar
            </Button>
          ) : null}
          {status === "open" || status === "disqualified" ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => archiveLead(leadId), "Lead arquivado.")}
            >
              Arquivar
            </Button>
          ) : null}
          {status === "disqualified" || status === "archived" ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => reopenLead(leadId), "Lead reaberto.")}
            >
              Reabrir
            </Button>
          ) : null}
          <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Desqualificar lead</DialogTitle>
                <DialogDescription>Escolha o motivo. O lead passa para a aba Desqualificados.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="disq-reason">Motivo</Label>
                  <select
                    id="disq-reason"
                    value={reasonId}
                    onChange={(e) => setReasonId(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="">Escolha um motivo</option>
                    {reasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="disq-note">Observação</Label>
                  <Textarea id="disq-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
                </div>
                {error ? (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    run(() => disqualifyLead(leadId, { reasonId, note }), "Lead desqualificado.", () =>
                      onOpenChange(false),
                    );
                  }}
                >
                  Confirmar desqualificação
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
