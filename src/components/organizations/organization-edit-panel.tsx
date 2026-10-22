"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { updateOrganization } from "@/lib/organizations/actions";
import type { OrganizationDetail } from "@/lib/organizations/queries";
import type { AssignableOwner } from "@/lib/records/types";
import { OrganizationForm } from "./organization-form";

export function OrganizationEditPanel({
  organization,
  defs,
  owners,
  canEdit,
}: {
  organization: OrganizationDetail;
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
  canEdit: boolean;
}) {
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Dados</CardTitle>
      </CardHeader>
      <CardContent>
        <OrganizationForm
          companyId={organization.companyId}
          companySlug={organization.companySlug}
          defs={defs}
          owners={owners}
          excludeId={organization.id}
          readOnly={!canEdit}
          initial={{
            name: organization.name,
            legalName: organization.legalName,
            cnpj: organization.cnpj,
            domain: organization.domain,
            segment: organization.segment,
            address: organization.address,
            customFields: organization.customFields,
          }}
          onSubmit={async (input) => {
            const res = await updateOrganization(organization.id, input);
            if (res.ok) {
              toast.success("Organização atualizada.");
              router.refresh();
            }
            return res;
          }}
        />
      </CardContent>
    </Card>
  );
}
