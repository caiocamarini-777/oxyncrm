"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { CustomFieldInput } from "@/components/records/custom-field";
import { DuplicateWarning, useDuplicateMatches } from "@/components/records/duplicate-warning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj, isValidCnpj, onlyDigits } from "@/lib/companies/cnpj";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import type { ActionResult } from "@/lib/db-errors";
import { findOrganizationDuplicates } from "@/lib/organizations/actions";
import { BR_STATES, normalizeDomain, type OrganizationInput } from "@/lib/organizations/schema";
import type { OrganizationAddress } from "@/lib/organizations/queries";
import { recordHref, type AssignableOwner } from "@/lib/records/types";

export type OrganizationFormValues = {
  name: string;
  legalName: string | null;
  cnpj: string | null;
  domain: string | null;
  segment: string | null;
  address: OrganizationAddress;
  customFields: Record<string, unknown>;
};

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

export function OrganizationForm({
  companyId,
  companySlug,
  defs,
  owners,
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
  initial?: OrganizationFormValues;
  excludeId?: string;
  readOnly?: boolean;
  submitLabel?: string;
  onSubmit: (input: OrganizationInput) => Promise<ActionResult<unknown>>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [legalName, setLegalName] = useState(initial?.legalName ?? "");
  const [cnpj, setCnpj] = useState(initial?.cnpj ? formatCnpj(initial.cnpj) : "");
  const [domain, setDomain] = useState(initial?.domain ?? "");
  const [segment, setSegment] = useState(initial?.segment ?? "");
  const [street, setStreet] = useState(initial?.address.street ?? "");
  const [number, setNumber] = useState(initial?.address.number ?? "");
  const [city, setCity] = useState(initial?.address.city ?? "");
  const [state, setState] = useState(initial?.address.state ?? "");
  const [zip, setZip] = useState(initial?.address.zip ?? "");
  const [custom, setCustom] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const d of defs) out[d.key] = initial?.customFields[d.key] ?? null;
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const digits = onlyDigits(cnpj);
  const dom = normalizeDomain(domain);
  const cnpjOk = digits.length === 14 && isValidCnpj(digits);
  const domOk = DOMAIN_RE.test(dom);
  const matches = useDuplicateMatches(`${cnpjOk ? digits : ""}|${domOk ? dom : ""}`, async () => {
    if (!cnpjOk && !domOk) return [];
    const res = await findOrganizationDuplicates(
      companyId,
      { cnpj: cnpjOk ? digits : null, domain: domOk ? dom : null },
      excludeId,
    );
    return res.ok ? res.data : [];
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await onSubmit({
        name,
        legalName,
        cnpj,
        domain,
        segment,
        address: { street, number, city, state, zip },
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
        <Field id="org-name" label="Nome" error={errors.name}>
          <Input id="org-name" value={name} maxLength={200} aria-invalid={Boolean(errors.name)} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="org-legal" label="Razão social" error={errors.legalName}>
          <Input id="org-legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </Field>
        <Field id="org-cnpj" label="CNPJ" error={errors.cnpj}>
          <Input
            id="org-cnpj"
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            value={cnpj}
            aria-invalid={Boolean(errors.cnpj)}
            onChange={(e) => setCnpj(formatCnpj(e.target.value))}
          />
        </Field>
        <Field id="org-domain" label="Domínio" error={errors.domain}>
          <Input
            id="org-domain"
            placeholder="empresa.com.br"
            value={domain}
            aria-invalid={Boolean(errors.domain)}
            onChange={(e) => setDomain(e.target.value)}
          />
        </Field>
        <DuplicateWarning
          matches={matches}
          subject="uma organização"
          hrefFor={(id) => recordHref("organizations", companySlug, id)}
        />
        <Field id="org-segment" label="Segmento" error={errors.segment}>
          <Input id="org-segment" value={segment} onChange={(e) => setSegment(e.target.value)} />
        </Field>

        <p className="mt-1 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">Endereço</p>
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <Field id="org-street" label="Rua" error={errors.street}>
            <Input id="org-street" value={street} onChange={(e) => setStreet(e.target.value)} />
          </Field>
          <Field id="org-number" label="Número" error={errors.number}>
            <Input id="org-number" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <Field id="org-city" label="Cidade" error={errors.city}>
            <Input id="org-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field id="org-state" label="UF" error={errors.state}>
            <select
              id="org-state"
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">--</option>
              {BR_STATES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="org-zip" label="CEP" error={errors.zip}>
          <Input id="org-zip" inputMode="numeric" placeholder="00000-000" value={zip} onChange={(e) => setZip(e.target.value)} />
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
