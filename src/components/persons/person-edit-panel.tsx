"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { updatePerson } from "@/lib/persons/actions";
import type { PersonDetail } from "@/lib/persons/queries";
import type { AssignableOwner } from "@/lib/records/types";
import { PersonForm } from "./person-form";

export function PersonEditPanel({
  person,
  defs,
  owners,
  canEdit,
  canCreateOrganization,
}: {
  person: PersonDetail;
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
  canEdit: boolean;
  canCreateOrganization: boolean;
}) {
  const router = useRouter();
  const org = person.organization;
  // Organização sem acesso ou na lixeira continua vinculada até alguém trocar.
  const organization =
    person.organizationId && org
      ? {
          id: person.organizationId,
          name:
            org.state === "ok"
              ? org.name
              : org.state === "trashed"
                ? `${org.name} (na lixeira)`
                : org.name
                  ? `${org.name} (sem acesso)`
                  : "(sem acesso)",
        }
      : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Dados</CardTitle>
      </CardHeader>
      <CardContent>
        <PersonForm
          companyId={person.companyId}
          companySlug={person.companySlug}
          defs={defs}
          owners={owners}
          canCreateOrganization={canCreateOrganization}
          excludeId={person.id}
          readOnly={!canEdit}
          initial={{
            fullName: person.fullName,
            jobTitle: person.jobTitle,
            organization,
            emails: person.emails,
            phones: person.phones,
            linkedinUrl: person.linkedinUrl,
            customFields: person.customFields,
          }}
          onSubmit={async (input) => {
            const res = await updatePerson(person.id, input);
            if (res.ok) {
              toast.success("Pessoa atualizada.");
              router.refresh();
            }
            return res;
          }}
        />
      </CardContent>
    </Card>
  );
}
