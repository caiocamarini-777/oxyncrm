"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { convertLead } from "@/lib/deals/actions";
import { requiredFieldLabel } from "@/lib/deals/required";
import type { CreatablePipeline } from "@/components/deals/create-deal-dialog";

const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm";

/** Converte o lead em negócio: funil, etapa e título; sucesso leva ao negócio criado. */
export function ConvertLeadDialog({
  leadId,
  leadTitle,
  empresa,
  pipelines,
  defs,
}: {
  leadId: string;
  leadTitle: string;
  empresa: string;
  /** Funis e etapas não arquivados. */
  pipelines: CreatablePipeline[];
  /** Campos personalizados ativos de negócios (nomes dos obrigatórios). */
  defs: CustomFieldDef[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const [stageId, setStageId] = useState(pipelines[0]?.stages[0]?.id ?? "");
  const [title, setTitle] = useState(leadTitle);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];

  function change(next: boolean) {
    setOpen(next);
    if (next) {
      setPipelineId(pipelines[0]?.id ?? "");
      setStageId(pipelines[0]?.stages[0]?.id ?? "");
      setTitle(leadTitle);
      setError(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await convertLead(leadId, { pipelineId, stageId, title });
      if (res.ok) {
        toast.success("Lead convertido em negócio.");
        setOpen(false);
        router.push(`/${empresa}/negocios/${res.data.dealId}`);
        return;
      }
      setError(
        res.missing && res.missing.length > 0
          ? `Esta etapa exige: ${res.missing.map((k) => requiredFieldLabel(k, defs)).join(", ")}. Escolha outra etapa.`
          : res.error,
      );
    });
  }

  return (
    <>
      <Button type="button" onClick={() => change(true)} disabled={pipelines.length === 0}>
        Converter em negócio
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Converter em negócio</DialogTitle>
            <DialogDescription>
              Pessoa, organização, valor e etiquetas do lead passam para o negócio.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="convert-title">Título do negócio</Label>
                <Input id="convert-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="convert-pipeline">Funil</Label>
                  <select
                    id="convert-pipeline"
                    value={pipelineId}
                    className={selectClass}
                    onChange={(e) => {
                      setPipelineId(e.target.value);
                      setStageId(pipelines.find((p) => p.id === e.target.value)?.stages[0]?.id ?? "");
                    }}
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="convert-stage">Etapa</Label>
                  <select
                    id="convert-stage"
                    value={stageId}
                    className={selectClass}
                    onChange={(e) => setStageId(e.target.value)}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => change(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !stageId}>
                Converter
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
