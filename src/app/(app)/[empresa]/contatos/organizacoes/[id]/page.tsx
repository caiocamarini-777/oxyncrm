import { notFound } from "next/navigation";
import { OrganizationEditPanel } from "@/components/organizations/organization-edit-panel";
import { OrganizationPersons } from "@/components/organizations/organization-persons";
import { RecordHeader } from "@/components/records/record-header";
import { NoteComposer } from "@/components/records/note-composer";
import { RecordTabs } from "@/components/records/record-tabs";
import { Timeline } from "@/components/records/timeline";
import { getTimeline } from "@/lib/timeline/queries";
import { RecordLayout } from "@/components/records/record-layout";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getOrganization } from "@/lib/organizations/queries";
import { listActiveCustomFieldDefs, listCompanyLabels } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";

export const instant = false;

export default async function OrganizationPage({
  params,
}: {
  params: Promise<{ empresa: string; id: string }>;
}) {
  const [{ empresa, id }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  // Inexistente, de outra empresa ou sem acesso: sempre o mesmo 404.
  const organization = await getOrganization(id);
  if (!organization) notFound();
  if (scope.kind === "company" && scope.company.id !== organization.companyId) notFound();

  const [timeline, owners, labels, defs, permissions] = await Promise.all([
    getTimeline("organizations", organization.id),
    listAssignableOwners(organization.companyId),
    listCompanyLabels(organization.companyId),
    listActiveCustomFieldDefs(organization.companyId, "organizations"),
    getEntityPermissions(organization.companyId, "organizations"),
  ]);

  return (
    <RecordLayout
      header={
        <RecordHeader
          entity="organizations"
          noun={{
            singular: "organização",
            trashedToast: "Organização movida para a lixeira.",
            trashDescription: "A organização some das listas e pode ser restaurada pela lixeira por 30 dias.",
          }}
          id={organization.id}
          companyId={organization.companyId}
          companyName={organization.companyName}
          listHref={`/${empresa}/contatos/organizacoes`}
          name={organization.name}
          ownerId={organization.ownerId}
          owners={owners}
          labels={labels}
          labelIds={organization.labelIds}
          canEdit={permissions.edit}
          canDelete={permissions.delete}
          canReassign={permissions.reassign}
        />
      }
      details={
        <div className="flex flex-col gap-4">
          <OrganizationEditPanel organization={organization} defs={defs} owners={owners} canEdit={permissions.edit} />
          <OrganizationPersons organization={organization} />
        </div>
      }
      main={
        <RecordTabs
          notes={<NoteComposer entity="organizations" recordId={organization.id} />}
          timeline={<Timeline items={timeline} />}
        />
      }
    />
  );
}
