"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { updateLead } from "@/lib/leads/actions";
import type { LeadDetail, LeadLink } from "@/lib/leads/queries";
import type { AssignableOwner } from "@/lib/records/types";
import { LeadForm, type LeadSourceOption } from "./lead-form";
import type { PartyValue } from "./party-combobox";

/** Vínculo sem acesso ou na lixeira continua ligado até alguém trocar. */
function toParty(id: string | null, link: LeadLink | null): PartyValue | null {
  if (!id || !link) return null;
  if (link.state === "ok") return { id, name: link.name };
  if (link.state === "trashed") return { id, name: `${link.name} (na lixeira)` };
  return { id, name: "(sem acesso)" };
}

export function LeadEditPanel({
  lead,
  defs,
  owners,
  sources,
  canEdit,
}: {
  lead: LeadDetail;
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
  sources: LeadSourceOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Dados</CardTitle>
      </CardHeader>
      <CardContent>
        <LeadForm
          companyId={lead.companyId}
          defs={defs}
          owners={owners}
          sources={sources}
          canCreatePerson={false}
          canCreateOrganization={false}
          readOnly={!canEdit}
          initial={{
            title: lead.title,
            sourceId: lead.sourceId,
            person: toParty(lead.personId, lead.person),
            organization: toParty(lead.organizationId, lead.organization),
            estimatedValue: lead.estimatedValue,
            customFields: lead.customFields,
          }}
          onSubmit={async ({ input }) => {
            const res = await updateLead(lead.id, input);
            if (res.ok) {
              toast.success("Lead atualizado.");
              router.refresh();
            }
            return res;
          }}
        />
      </CardContent>
    </Card>
  );
}
