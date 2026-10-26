"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { CompanyPicker } from "@/components/records/company-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CompanySummary } from "@/lib/companies/pure";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { createLead } from "@/lib/leads/actions";
import type { AssignableOwner } from "@/lib/records/types";
import { LeadForm, type LeadSourceOption } from "./lead-form";

export type CreatableLeadCompany = {
  company: CompanySummary;
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
  sources: LeadSourceOption[];
  canCreatePerson: boolean;
  canCreateOrganization: boolean;
};

/** Na visão "Todas" (`askCompany`), pergunta a empresa antes de abrir o formulário. */
export function CreateLeadDialog({ options, askCompany }: { options: CreatableLeadCompany[]; askCompany: boolean }) {
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
        <Plus /> Novo lead
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Novo lead</DialogTitle>
            <DialogDescription>
              {current && askCompany ? `Empresa: ${current.company.name}` : "Dados do lead."}
            </DialogDescription>
          </DialogHeader>
          {!current ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">Em qual empresa criar o lead?</p>
              <CompanyPicker entity="leads" companies={options.map((o) => o.company)} onSelect={(c) => setPicked(c.id)} />
            </div>
          ) : (
            <LeadForm
              key={current.company.id}
              companyId={current.company.id}
              defs={current.defs}
              owners={current.owners}
              sources={current.sources}
              canCreatePerson={current.canCreatePerson}
              canCreateOrganization={current.canCreateOrganization}
              submitLabel="Criar lead"
              onCancel={() => onOpenChange(false)}
              onSubmit={async ({ input, created }) => {
                const res = await createLead(current.company.id, input, created);
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
