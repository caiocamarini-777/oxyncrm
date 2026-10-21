"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCompany, updateCompany } from "@/lib/companies/actions";
import { formatCnpj } from "@/lib/companies/cnpj";
import { slugify } from "@/lib/companies/slug";

export type CompanyRow = {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  cnpj: string | null;
};

export function CompanyForm({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: CompanyRow | null;
}) {
  // O conteúdo remonta a cada abertura (key), então o estado inicial vale por abertura.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <FormBody
          key={company?.id ?? "new"}
          company={company}
          close={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormBody({ company, close }: { company: CompanyRow | null; close: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(company?.name ?? "");
  const [slug, setSlug] = useState(company?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(company));
  const [legalName, setLegalName] = useState(company?.legalName ?? "");
  const [cnpj, setCnpj] = useState(company?.cnpj ? formatCnpj(company.cnpj) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const input = { name, slug, legalName, cnpj };
      const result = company ? await updateCompany(company.id, input) : await createCompany(input);
      if (result.ok) {
        close();
        router.refresh();
      } else {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? null : result.error);
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{company ? "Editar empresa" : "Nova empresa"}</DialogTitle>
        <DialogDescription>
          O endereço (slug) aparece na URL das telas da empresa.
        </DialogDescription>
      </DialogHeader>

      <Field id="company-name" label="Nome" error={errors.name}>
        <Input
          id="company-name"
          value={name}
          aria-invalid={Boolean(errors.name)}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field id="company-slug" label="Endereço (slug)" error={errors.slug}>
        <Input
          id="company-slug"
          value={slug}
          aria-invalid={Boolean(errors.slug)}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
        />
      </Field>
      <Field id="company-legal" label="Razão social" error={errors.legalName}>
        <Input
          id="company-legal"
          value={legalName}
          aria-invalid={Boolean(errors.legalName)}
          onChange={(e) => setLegalName(e.target.value)}
        />
      </Field>
      <Field id="company-cnpj" label="CNPJ" error={errors.cnpj}>
        <Input
          id="company-cnpj"
          inputMode="numeric"
          placeholder="00.000.000/0000-00"
          value={cnpj}
          aria-invalid={Boolean(errors.cnpj)}
          onChange={(e) => setCnpj(formatCnpj(e.target.value))}
        />
      </Field>

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
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
