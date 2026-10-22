"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { CustomFieldInput } from "@/components/records/custom-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import type { ActionResult } from "@/lib/db-errors";
import type { NewParty } from "@/lib/leads/actions";
import type { LeadInput } from "@/lib/leads/schema";
import type { AssignableOwner } from "@/lib/records/types";
import { PartyCombobox, type PartyValue } from "./party-combobox";

export type LeadSourceOption = { id: string; name: string; active: boolean };

export type LeadFormValues = {
  title: string;
  sourceId: string | null;
  person: PartyValue | null;
  organization: PartyValue | null;
  estimatedValue: number | null;
  customFields: Record<string, unknown>;
};

export type LeadFormSubmit = {
  input: LeadInput;
  created: { person?: NewParty; organization?: NewParty };
};

export function LeadForm({
  companyId,
  defs,
  owners,
  sources,
  canCreatePerson,
  canCreateOrganization,
  initial,
  readOnly = false,
  submitLabel = "Salvar",
  onSubmit,
  onCancel,
}: {
  companyId: string;
  /** Somente definições ativas. */
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
  /** Todas as origens; as inativas só aparecem se forem a origem atual do lead. */
  sources: LeadSourceOption[];
  canCreatePerson: boolean;
  canCreateOrganization: boolean;
  initial?: LeadFormValues;
  readOnly?: boolean;
  submitLabel?: string;
  onSubmit: (data: LeadFormSubmit) => Promise<ActionResult<unknown>>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sourceId, setSourceId] = useState(initial?.sourceId ?? "");
  const [person, setPerson] = useState<PartyValue | null>(initial?.person ?? null);
  const [organization, setOrganization] = useState<PartyValue | null>(initial?.organization ?? null);
  const [value, setValue] = useState(initial?.estimatedValue === null || initial?.estimatedValue === undefined ? "" : String(initial.estimatedValue));
  const [custom, setCustom] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const d of defs) out[d.key] = initial?.customFields[d.key] ?? null;
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = sources.filter((s) => s.active || s.id === initial?.sourceId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await onSubmit({
        input: {
          title,
          sourceId: sourceId || null,
          personId: person?.id ?? null,
          organizationId: organization?.id ?? null,
          estimatedValue: value,
          customFields: custom,
        },
        created: {
          person: person && person.id === null ? { name: person.name } : undefined,
          organization: organization && organization.id === null ? { name: organization.name } : undefined,
        },
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.fieldErrors ? null : res.error);
        if (res.fieldErrors) toast.error(res.error);
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <fieldset disabled={readOnly || pending} className="flex min-w-0 flex-col gap-3">
        <Field id="lead-title" label="Título" error={errors.title}>
          <Input id="lead-title" value={title} maxLength={200} aria-invalid={Boolean(errors.title)} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field id="lead-person-search" label="Pessoa" error={errors.personId}>
          <PartyCombobox kind="person" companyId={companyId} value={person} onChange={setPerson} canCreate={canCreatePerson} readOnly={readOnly} />
        </Field>
        <Field id="lead-organization-search" label="Organização" error={errors.organizationId}>
          <PartyCombobox
            kind="organization"
            companyId={companyId}
            value={organization}
            onChange={setOrganization}
            canCreate={canCreateOrganization}
            readOnly={readOnly}
          />
        </Field>
        <Field id="lead-source" label="Origem" error={errors.sourceId}>
          <select
            id="lead-source"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Sem origem</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.active ? s.name : `${s.name} (inativa)`}
              </option>
            ))}
          </select>
        </Field>
        <Field id="lead-value" label="Valor estimado (R$)" error={errors.estimatedValue}>
          <Input
            id="lead-value"
            inputMode="decimal"
            placeholder="0,00"
            value={value}
            aria-invalid={Boolean(errors.estimatedValue)}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>

        {defs.length > 0 ? (
          <p className="mt-1 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Campos personalizados
          </p>
        ) : null}
        {defs.map((d) => (
          <Field key={d.key} id={`cf-${d.key}`} label={d.label} error={errors[`cf-${d.key}`]}>
            <CustomFieldInput
              def={d}
              value={custom[d.key]}
              owners={owners}
              onChange={(v) => setCustom((c) => ({ ...c, [d.key]: v }))}
            />
          </Field>
        ))}
      </fieldset>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="flex justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Salvando..." : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
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
