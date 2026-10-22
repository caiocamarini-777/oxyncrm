"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DealResult } from "@/lib/deals/actions";
import type { LostInput } from "@/lib/deals/schema";

export type LostReasonOption = { id: string; name: string };

/** Motivo obrigatório (motivos ativos da empresa) e observação opcional. */
export function LostDialog({
  open,
  onOpenChange,
  dealTitle,
  reasons,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealTitle: string;
  reasons: LostReasonOption[];
  onConfirm: (input: LostInput) => Promise<DealResult>;
}) {
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    if (!next) {
      setReasonId("");
      setNote("");
      setError(null);
    }
    onOpenChange(next);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reasonId) {
      setError("Escolha um motivo.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await onConfirm({ reasonId, note });
      if (res.ok) change(false);
      else setError(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar como perdido</DialogTitle>
          <DialogDescription>{dealTitle}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <fieldset disabled={pending} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lost-reason">Motivo</Label>
              <select
                id="lost-reason"
                value={reasonId}
                aria-invalid={Boolean(error && !reasonId)}
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
              <Label htmlFor="lost-note">Observação</Label>
              <Textarea id="lost-note" value={note} maxLength={1000} rows={3} onChange={(e) => setNote(e.target.value)} />
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => change(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? "Salvando..." : "Marcar como perdido"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
