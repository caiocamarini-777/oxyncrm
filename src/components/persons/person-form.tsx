"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { CustomFieldInput } from "@/components/records/custom-field";
import { DuplicateWarning, useDuplicateMatches } from "@/components/records/duplicate-warning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import type { ActionResult } from "@/lib/db-errors";
import { findPersonDuplicates } from "@/lib/persons/actions";
import type { ContactEntry, PersonInput } from "@/lib/persons/schema";
import { recordHref, type AssignableOwner } from "@/lib/records/types";
import { ContactListEditor, type ContactRow } from "./contact-list-editor";
import { OrganizationCombobox, type OrganizationOption } from "./organization-combobox";

export type PersonFormValues = {
  fullName: string;
  jobTitle: string | null;
  organization: OrganizationOption | null;
  emails: ContactEntry[];
  phones: ContactEntry[];
  linkedinUrl: string | null;
  customFields: Record<string, unknown>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function indexedErrors(errors: Record<string, string>, prefix: string): Record<number, string | undefined> {
  const out: Record<number, string | undefined> = {};
  for (const [k, v] of Object.entries(errors)) {
    if (k.startsWith(`${prefix}-`)) out[Number(k.slice(prefix.length + 1))] = v;
  }
  return out;
}

export function PersonForm({
  companyId,
  companySlug,
  defs,
  owners,
  canCreateOrganization,
  initial,
  excludeId,
  readOnly = false,
  submitLabel = "Salvar",
  onSubmit,
  onCancel,
}: {
  companyId: string;
  companySlug: string;
  /** Somente definições ativas. */
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
  canCreateOrganization: boolean;
  initial?: PersonFormValues;
  excludeId?: string;
  readOnly?: boolean;
  submitLabel?: string;
  onSubmit: (input: PersonInput) => Promise<ActionResult<unknown>>;
  onCancel?: () => void;
}) {
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? "");
  const [organization, setOrganization] = useState<OrganizationOption | null>(initial?.organization ?? null);
  const [emails, setEmails] = useState<ContactRow[]>(initial?.emails ?? []);
  const [phones, setPhones] = useState<ContactRow[]>(initial?.phones ?? []);
  const [linkedinUrl, setLinkedinUrl] = useState(initial?.linkedinUrl ?? "");
  const [custom, setCustom] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const d of defs) out[d.key] = initial?.customFields[d.key] ?? null;
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const validEmails = emails.map((e) => e.value.trim().toLowerCase()).filter((v) => EMAIL_RE.test(v));
  const validPhones = phones.map((p) => p.value.replace(/\D/g, "")).filter((v) => v.length >= 10 && v.length <= 13);
  const matches = useDuplicateMatches(`${validEmails.join(",")}|${validPhones.join(",")}`, async () => {
    if (validEmails.length === 0 && validPhones.length === 0) return [];
    const res = await findPersonDuplicates(companyId, { emails: validEmails, phones: validPhones }, excludeId);
    return res.ok ? res.data : [];
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await onSubmit({
        fullName,
        jobTitle,
        organizationId: organization?.id ?? null,
        emails,
        phones,
        linkedinUrl,
        customFields: custom,
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
        <Field id="person-name" label="Nome" error={errors.fullName}>
          <Input id="person-name" value={fullName} maxLength={200} aria-invalid={Boolean(errors.fullName)} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        <Field id="person-job" label="Cargo" error={errors.jobTitle}>
          <Input id="person-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        </Field>
        <Field id="person-organization-search" label="Organização" error={errors.organizationId}>
          <OrganizationCombobox
            companyId={companyId}
            value={organization}
            onChange={setOrganization}
            canCreate={canCreateOrganization}
          />
        </Field>

        <p className="mt-1 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">E-mails</p>
        <ContactListEditor kind="email" rows={emails} errors={indexedErrors(errors, "emails")} onChange={setEmails} />
        <p className="mt-1 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">Telefones</p>
        <ContactListEditor kind="phone" rows={phones} errors={indexedErrors(errors, "phones")} onChange={setPhones} />
        <DuplicateWarning
          matches={matches}
          subject="uma pessoa"
          hrefFor={(id) => recordHref("persons", companySlug, id)}
        />

        <Field id="person-linkedin" label="LinkedIn" error={errors.linkedinUrl}>
          <Input
            id="person-linkedin"
            placeholder="https://www.linkedin.com/in/..."
            value={linkedinUrl}
            aria-invalid={Boolean(errors.linkedinUrl)}
            onChange={(e) => setLinkedinUrl(e.target.value)}
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
