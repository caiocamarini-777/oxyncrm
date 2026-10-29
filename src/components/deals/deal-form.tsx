"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PartyCombobox, type PartyValue } from "@/components/leads/party-combobox";
import { CustomFieldInput } from "@/components/records/custom-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ServiceCategorySelect } from "@/components/records/service-category-select";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { updateDeal } from "@/lib/deals/actions";
import type { DealDetail, DealLink } from "@/lib/deals/queries";
import type { AssignableOwner } from "@/lib/records/types";

/** Vínculo sem acesso ou na lixeira continua ligado até alguém trocar. */
function toParty(id: string | null, link: DealLink | null): PartyValue | null {
  if (!id || !link) return null;
  if (link.state === "ok") return { id, name: link.name };
  if (link.state === "trashed") return { id, name: `${link.name} (na lixeira)` };
  return { id, name: "(sem acesso)" };
}

/** Dados básicos do negócio: título, pessoa, organização, valor estimado, fechamento e campos personalizados. */
export function DealForm({
  deal,
  defs,
  owners,
  canEdit,
  canCreateCategory = false,
}: {
  deal: DealDetail;
  /** Somente definições ativas. */
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
  canEdit: boolean;
  /** Só o admin geral cria categorias de serviço. */
  canCreateCategory?: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(deal.title);
  const [person, setPerson] = useState<PartyValue | null>(toParty(deal.personId, deal.person));
  const [organization, setOrganization] = useState<PartyValue | null>(toParty(deal.organizationId, deal.organization));
  const [value, setValue] = useState(deal.estimatedValue === null ? "" : String(deal.estimatedValue).replace(".", ","));
  const [categoryId, setCategoryId] = useState<string | null>(deal.serviceCategoryId);
  const [closeDate, setCloseDate] = useState(deal.expectedCloseDate ?? "");
  const [custom, setCustom] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const d of defs) out[d.key] = deal.customFields[d.key] ?? null;
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const res = await updateDeal(deal.id, {
        title,
        personId: person?.id ?? null,
        organizationId: organization?.id ?? null,
        estimatedValue: value,
        expectedCloseDate: closeDate || null,
        // Com itens, cada item carrega a sua categoria; o campo do negócio fica de fora.
        ...(deal.items.length === 0 ? { serviceCategoryId: categoryId } : {}),
        customFields: custom,
      });
      if (res.ok) {
        toast.success("Negócio atualizado.");
        router.refresh();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(res.fieldErrors ? null : res.error);
      if (res.fieldErrors) toast.error(res.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Dados</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <fieldset disabled={!canEdit || pending} className="flex min-w-0 flex-col gap-3">
            <Field id="deal-title" label="Título" error={errors.title}>
              <Input id="deal-title" value={title} maxLength={200} aria-invalid={Boolean(errors.title)} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field id="lead-person-search" label="Pessoa" error={errors.personId}>
              <PartyCombobox kind="person" companyId={deal.companyId} value={person} onChange={setPerson} canCreate={false} readOnly={!canEdit} />
            </Field>
            <Field id="lead-organization-search" label="Organização" error={errors.organizationId}>
              <PartyCombobox
                kind="organization"
                companyId={deal.companyId}
                value={organization}
                onChange={setOrganization}
                canCreate={false}
                readOnly={!canEdit}
              />
            </Field>
            <Field id="deal-value" label="Valor estimado (R$)" error={errors.estimatedValue}>
              <Input
                id="deal-value"
                inputMode="decimal"
                placeholder="0,00"
                value={value}
                aria-invalid={Boolean(errors.estimatedValue)}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <Field id="deal-close" label="Data de fechamento esperada" error={errors.expectedCloseDate}>
              <Input id="deal-close" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
            </Field>
            {deal.items.length === 0 ? (
              <Field id="deal-category" label="Categoria de serviço" error={errors.serviceCategoryId}>
                <ServiceCategorySelect id="deal-category" companyId={deal.companyId} value={categoryId} onChange={setCategoryId} allowCreate={canCreateCategory} />
              </Field>
            ) : null}
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
          {canEdit ? (
            <div className="flex justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
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
