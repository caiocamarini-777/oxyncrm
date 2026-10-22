"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { PartyCombobox, type PartyValue } from "@/components/leads/party-combobox";
import { CustomFieldInput } from "@/components/records/custom-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { createDeal } from "@/lib/deals/actions";
import { requiredFieldLabel } from "@/lib/deals/required";
import type { AssignableOwner } from "@/lib/records/types";

export type CreatablePipeline = { id: string; name: string; stages: { id: string; name: string }[] };

const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm";

/** Novo negócio no funil atual (etapa escolhida; o negócio entra no fim da coluna). */
export function CreateDealDialog({
  companyId,
  pipelines,
  defaultPipelineId,
  defs,
  owners,
}: {
  companyId: string;
  pipelines: CreatablePipeline[];
  defaultPipelineId: string;
  /** Somente definições ativas. */
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => initial(defaultPipelineId, pipelines, defs));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const stages = pipelines.find((p) => p.id === form.pipelineId)?.stages ?? [];

  function change(next: boolean) {
    setOpen(next);
    if (next) {
      setForm(initial(defaultPipelineId, pipelines, defs));
      setErrors({});
      setFormError(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await createDeal(companyId, {
        title: form.title,
        pipelineId: form.pipelineId || null,
        stageId: form.stageId || null,
        personId: form.person?.id ?? null,
        organizationId: form.organization?.id ?? null,
        estimatedValue: form.value,
        expectedCloseDate: form.closeDate || null,
        customFields: form.custom,
      });
      if (res.ok) {
        toast.success("Negócio criado.");
        setOpen(false);
        router.refresh();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(
        res.missing && res.missing.length > 0
          ? `Esta etapa exige: ${res.missing.map((k) => requiredFieldLabel(k, defs)).join(", ")}.`
          : res.error,
      );
    });
  }

  return (
    <>
      <Button onClick={() => change(true)}>
        <Plus /> Novo negócio
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo negócio</DialogTitle>
            <DialogDescription>Dados do negócio.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
              <Field id="deal-title" label="Título" error={errors.title}>
                <Input
                  id="deal-title"
                  value={form.title}
                  maxLength={200}
                  aria-invalid={Boolean(errors.title)}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="deal-pipeline" label="Funil" error={errors.pipelineId}>
                  <select
                    id="deal-pipeline"
                    value={form.pipelineId}
                    className={selectClass}
                    onChange={(e) => {
                      const p = pipelines.find((x) => x.id === e.target.value);
                      setForm((f) => ({ ...f, pipelineId: e.target.value, stageId: p?.stages[0]?.id ?? "" }));
                    }}
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="deal-stage" label="Etapa" error={errors.stageId}>
                  <select
                    id="deal-stage"
                    value={form.stageId}
                    className={selectClass}
                    onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field id="lead-person-search" label="Pessoa" error={errors.personId}>
                <PartyCombobox
                  kind="person"
                  companyId={companyId}
                  value={form.person}
                  onChange={(v) => setForm((f) => ({ ...f, person: v }))}
                  canCreate={false}
                />
              </Field>
              <Field id="lead-organization-search" label="Organização" error={errors.organizationId}>
                <PartyCombobox
                  kind="organization"
                  companyId={companyId}
                  value={form.organization}
                  onChange={(v) => setForm((f) => ({ ...f, organization: v }))}
                  canCreate={false}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="deal-value" label="Valor estimado (R$)" error={errors.estimatedValue}>
                  <Input
                    id="deal-value"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={form.value}
                    onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  />
                </Field>
                <Field id="deal-close" label="Data de fechamento esperada" error={errors.expectedCloseDate}>
                  <Input
                    id="deal-close"
                    type="date"
                    value={form.closeDate}
                    onChange={(e) => setForm((f) => ({ ...f, closeDate: e.target.value }))}
                  />
                </Field>
              </div>
              {defs.length > 0 ? (
                <p className="mt-1 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Campos personalizados
                </p>
              ) : null}
              {defs.map((d) => (
                <Field key={d.key} id={`cf-${d.key}`} label={d.label} error={errors[`cf-${d.key}`]}>
                  <CustomFieldInput
                    def={d}
                    value={form.custom[d.key]}
                    owners={owners}
                    onChange={(v) => setForm((f) => ({ ...f, custom: { ...f.custom, [d.key]: v } }))}
                  />
                </Field>
              ))}
            </fieldset>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => change(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando..." : "Criar negócio"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function initial(pipelineId: string, pipelines: CreatablePipeline[], defs: CustomFieldDef[]) {
  const p = pipelines.find((x) => x.id === pipelineId) ?? pipelines[0];
  const custom: Record<string, unknown> = {};
  for (const d of defs) custom[d.key] = null;
  return {
    title: "",
    pipelineId: p?.id ?? "",
    stageId: p?.stages[0]?.id ?? "",
    person: null as PartyValue | null,
    organization: null as PartyValue | null,
    value: "",
    closeDate: "",
    custom,
  };
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
