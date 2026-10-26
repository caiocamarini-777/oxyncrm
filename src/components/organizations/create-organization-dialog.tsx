"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CompanyPicker } from "@/components/records/company-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CompanySummary } from "@/lib/companies/pure";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { createOrganization } from "@/lib/organizations/actions";
import type { AssignableOwner } from "@/lib/records/types";
import { OrganizationForm } from "./organization-form";

export type CreatableCompany = {
  company: CompanySummary;
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
};

/** Na visão "Todas" (`askCompany`), pergunta a empresa antes de abrir o formulário. */
export function CreateOrganizationDialog({
  options,
  askCompany,
}: {
  options: CreatableCompany[];
  askCompany: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const router = useRouter();
  const current = askCompany ? options.find((o) => o.company.id === picked) : options[0];

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setPicked(null);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Nova organização
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova organização</DialogTitle>
            <DialogDescription>
              {current && askCompany ? `Empresa: ${current.company.name}` : "Dados da organização."}
            </DialogDescription>
          </DialogHeader>
          {!current ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">Em qual empresa criar a organização?</p>
              <CompanyPicker
                entity="organizations"
                companies={options.map((o) => o.company)}
                onSelect={(c) => setPicked(c.id)}
              />
            </div>
          ) : (
            <OrganizationForm
              key={current.company.id}
              companyId={current.company.id}
              companySlug={current.company.slug}
              defs={current.defs}
              owners={current.owners}
              submitLabel="Criar organização"
              onCancel={() => onOpenChange(false)}
              onSubmit={async (input) => {
                const res = await createOrganization(current.company.id, input);
                if (res.ok) {
                  onOpenChange(false);
                  router.refresh();
                }
                return res;
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
