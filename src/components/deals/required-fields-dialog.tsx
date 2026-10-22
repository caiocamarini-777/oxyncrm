"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ContractFields, contractValuesFrom, Field, moneyText } from "@/components/deals/contract-fields";
import { PartyCombobox, type PartyValue } from "@/components/leads/party-combobox";
import { CustomFieldInput } from "@/components/records/custom-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { updateContract, updateDeal, type DealEditSnapshot, type DealResult } from "@/lib/deals/actions";
import { requiredFieldLabel } from "@/lib/deals/required";
import type { AssignableOwner } from "@/lib/records/types";

const BASIC = ["expected_close_date", "person_id", "organization_id", "estimated_value"];

/**
 * Pede só os campos obrigatórios que faltam para entrar na etapa, grava e repete o movimento
 * (`onRetry`). Se ainda faltar algo (por exemplo, produtos), a lista é atualizada.
 */
export function RequiredFieldsDialog({
  deal,
  stageName,
  missing: initialMissing,
  companyId,
  dealHref,
  defs,
  owners = [],
  onRetry,
  onClose,
  onCloseAutoFocus,
  productsTargetId,
}: {
  deal: DealEditSnapshot;
  stageName: string;
  missing: string[];
  companyId: string;
  /** Detalhe do negócio (onde se adicionam produtos). */
  dealHref: string;
  /** Somente definições ativas. */
  defs: CustomFieldDef[];
  owners?: AssignableOwner[];
  onRetry: () => Promise<DealResult>;
  onClose: () => void;
  /** Para devolver o foco a quem abriu (o diálogo pode abrir sem um gatilho). */
  onCloseAutoFocus?: (e: Event) => void;
  /** Na própria página do negócio: id do cartão Produtos, que recebe o foco em vez de navegar. */
  productsTargetId?: string;
}) {
  const toProducts = useRef(false);
  const [missing, setMissing] = useState(initialMissing);
  const [closeDate, setCloseDate] = useState(deal.expectedCloseDate ?? "");
  const [person, setPerson] = useState<PartyValue | null>(
    deal.personId ? { id: deal.personId, name: deal.personName ?? "" } : null,
  );
  const [organization, setOrganization] = useState<PartyValue | null>(
    deal.organizationId ? { id: deal.organizationId, name: deal.organizationName ?? "" } : null,
  );
  const [estimated, setEstimated] = useState(moneyText(deal.estimatedValue));
  const [contract, setContract] = useState(() => contractValuesFrom(deal));
  const [custom, setCustom] = useState<Record<string, unknown>>(() => {
    const out: Record<string, unknown> = {};
    for (const k of initialMissing) if (k.startsWith("cf:")) out[k.slice(3)] = deal.customFields[k.slice(3)] ?? null;
    return out;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const has = (k: string) => missing.includes(k);
  const cfKeys = missing.filter((k) => k.startsWith("cf:")).map((k) => k.slice(3));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      if (missing.some((k) => BASIC.includes(k) || k.startsWith("cf:"))) {
        const customFields: Record<string, unknown> = {};
        for (const k of cfKeys) customFields[k] = custom[k] ?? null;
        const res = await updateDeal(deal.id, {
          title: deal.title,
          personId: person?.id ?? null,
          organizationId: organization?.id ?? null,
          estimatedValue: has("estimated_value") ? estimated : deal.estimatedValue,
          expectedCloseDate: closeDate || null,
          customFields,
        });
        if (!res.ok) {
          setErrors(res.fieldErrors ?? {});
          setFormError(res.error);
          return;
        }
      }
      if (has("contract")) {
        const res = await updateContract(deal.id, contract);
        if (!res.ok) {
          setErrors(res.fieldErrors ?? {});
          setFormError(res.error);
          return;
        }
      }
      const moved = await onRetry();
      if (moved.ok) {
        onClose();
        return;
      }
      if (moved.missing && moved.missing.length > 0) {
        setMissing(moved.missing);
        setFormError("Ainda faltam campos para esta etapa.");
      } else {
        setFormError(moved.error);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        onCloseAutoFocus={(e) => {
          const target = toProducts.current && productsTargetId ? document.getElementById(productsTargetId) : null;
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ block: "start", behavior: "auto" });
            target.focus({ preventScroll: true });
            return;
          }
          onCloseAutoFocus?.(e);
        }}
      >
        <DialogHeader>
          <DialogTitle>Campos obrigatórios</DialogTitle>
          <DialogDescription>
            Para mover para {stageName}, preencha:
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
            {has("expected_close_date") ? (
              <Field id="req-close" label={requiredFieldLabel("expected_close_date")} error={errors.expectedCloseDate}>
                <Input id="req-close" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
              </Field>
            ) : null}
            {has("person_id") ? (
              <Field id="lead-person-search" label={requiredFieldLabel("person_id")} error={errors.personId}>
                <PartyCombobox kind="person" companyId={companyId} value={person} onChange={setPerson} canCreate={false} />
              </Field>
            ) : null}
            {has("organization_id") ? (
              <Field id="lead-organization-search" label={requiredFieldLabel("organization_id")} error={errors.organizationId}>
                <PartyCombobox
                  kind="organization"
                  companyId={companyId}
                  value={organization}
                  onChange={setOrganization}
                  canCreate={false}
                />
              </Field>
            ) : null}
            {has("estimated_value") ? (
              <Field id="req-value" label="Valor estimado (R$)" error={errors.estimatedValue}>
                <Input
                  id="req-value"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={estimated}
                  onChange={(e) => setEstimated(e.target.value)}
                />
              </Field>
            ) : null}
            {has("contract") ? (
              <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{requiredFieldLabel("contract")}</legend>
                <p className="text-xs text-muted-foreground">
                  Informe o setup com o mês da 1ª parcela, ou o MRR com o mês de início e a duração.
                </p>
                <ContractFields
                  idPrefix="req"
                  values={contract}
                  onChange={(k, v) => setContract((c) => ({ ...c, [k]: v }))}
                  errors={errors}
                />
              </fieldset>
            ) : null}
            {has("products") ? (
              <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                <span className="font-medium">{requiredFieldLabel("products")}</span>
                <span className="text-muted-foreground">Esta etapa exige ao menos um produto no negócio.</span>
                {productsTargetId ? (
                  <button
                    type="button"
                    className="self-start text-primary underline-offset-4 hover:underline"
                    onClick={() => {
                      toProducts.current = true;
                      onClose();
                    }}
                  >
                    Adicionar produtos
                  </button>
                ) : (
                  <Link href={dealHref} className="self-start text-primary underline-offset-4 hover:underline">
                    Adicionar produtos
                  </Link>
                )}
              </div>
            ) : null}
            {cfKeys.map((key) => {
              const def = defs.find((d) => d.key === key);
              if (!def) return null;
              return (
                <Field key={key} id={`cf-${key}`} label={def.label} error={errors[`cf-${key}`]}>
                  <CustomFieldInput
                    def={def}
                    value={custom[key]}
                    owners={owners}
                    onChange={(v) => setCustom((c) => ({ ...c, [key]: v }))}
                  />
                </Field>
              );
            })}
          </fieldset>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar e mover"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
