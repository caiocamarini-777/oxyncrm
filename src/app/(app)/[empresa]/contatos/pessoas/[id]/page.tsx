import { notFound } from "next/navigation";
import { PersonContacts } from "@/components/persons/person-contacts";
import { PersonEditPanel } from "@/components/persons/person-edit-panel";
import { PersonOrganizationLink } from "@/components/persons/person-organization-link";
import { RecordHeader } from "@/components/records/record-header";
import { RecordLayout } from "@/components/records/record-layout";
import { RecordTabs } from "@/components/records/record-tabs";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getPerson } from "@/lib/persons/queries";
import { listActiveCustomFieldDefs, listCompanyLabels } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";

export const instant = false;

export default async function PersonPage({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  const [{ empresa, id }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  // Inexistente, de outra empresa ou sem acesso: sempre o mesmo 404.
  const person = await getPerson(id);
  if (!person) notFound();
  if (scope.kind === "company" && scope.company.id !== person.companyId) notFound();

  const [owners, labels, defs, permissions, orgPermissions] = await Promise.all([
    listAssignableOwners(person.companyId),
    listCompanyLabels(person.companyId),
    listActiveCustomFieldDefs(person.companyId, "persons"),
    getEntityPermissions(person.companyId, "persons"),
    getEntityPermissions(person.companyId, "organizations"),
  ]);

  return (
    <RecordLayout
      header={
        <RecordHeader
          entity="persons"
          noun={{
            singular: "pessoa",
            trashedToast: "Pessoa movida para a lixeira.",
            trashDescription: "A pessoa some das listas e pode ser restaurada pela lixeira por 30 dias.",
          }}
          actions={<PersonOrganizationLink organization={person.organization} companySlug={person.companySlug} />}
          id={person.id}
          companyId={person.companyId}
          companyName={person.companyName}
          listHref={`/${empresa}/contatos`}
          name={person.fullName}
          ownerId={person.ownerId}
          owners={owners}
          labels={labels}
          labelIds={person.labelIds}
          canEdit={permissions.edit}
          canDelete={permissions.delete}
          canReassign={permissions.reassign}
        />
      }
      details={
        <div className="flex flex-col gap-4">
          <PersonContacts emails={person.emails} phones={person.phones} />
          <PersonEditPanel
            person={person}
            defs={defs}
            owners={owners}
            canEdit={permissions.edit}
            canCreateOrganization={orgPermissions.create}
          />
        </div>
      }
      main={<RecordTabs />}
    />
  );
}
