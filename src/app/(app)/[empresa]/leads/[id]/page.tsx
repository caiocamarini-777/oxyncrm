import { notFound } from "next/navigation";
import { LeadActions } from "@/components/leads/lead-actions";
import { LeadEditPanel } from "@/components/leads/lead-edit-panel";
import { LeadLinks } from "@/components/leads/lead-links";
import { NoteComposer } from "@/components/records/note-composer";
import { RecordHeader } from "@/components/records/record-header";
import { RecordLayout } from "@/components/records/record-layout";
import { RecordTabs } from "@/components/records/record-tabs";
import { Timeline } from "@/components/records/timeline";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getLead, listDisqualificationReasons, listLeadSources } from "@/lib/leads/queries";
import { listActiveCustomFieldDefs, listCompanyLabels } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";
import { getTimeline } from "@/lib/timeline/queries";

export const instant = false;

export default async function LeadPage({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  const [{ empresa, id }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  // Inexistente, de outra empresa ou sem acesso: sempre o mesmo 404.
  const lead = await getLead(id);
  if (!lead) notFound();
  if (scope.kind === "company" && scope.company.id !== lead.companyId) notFound();

  const [timeline, owners, labels, defs, permissions, sources, reasons] = await Promise.all([
    getTimeline("leads", lead.id),
    listAssignableOwners(lead.companyId),
    listCompanyLabels(lead.companyId),
    listActiveCustomFieldDefs(lead.companyId, "leads"),
    getEntityPermissions(lead.companyId, "leads"),
    listLeadSources(lead.companyId),
    listDisqualificationReasons(lead.companyId),
  ]);

  return (
    <RecordLayout
      header={
        <RecordHeader
          entity="leads"
          noun={{
            singular: "lead",
            trashedToast: "Lead movido para a lixeira.",
            trashDescription: "O lead some das listas e pode ser restaurado pela lixeira por 30 dias.",
          }}
          actions={
            <LeadActions leadId={lead.id} status={lead.status} reasons={reasons} canEdit={permissions.edit} />
          }
          id={lead.id}
          companyId={lead.companyId}
          companyName={lead.companyName}
          listHref={`/${empresa}/leads`}
          name={lead.title}
          ownerId={lead.ownerId}
          owners={owners}
          labels={labels}
          labelIds={lead.labelIds}
          canEdit={permissions.edit}
          canDelete={permissions.delete}
          canReassign={permissions.reassign}
        />
      }
      details={
        <div className="flex flex-col gap-4">
          <LeadLinks lead={lead} />
          <LeadEditPanel lead={lead} defs={defs} owners={owners} sources={sources} canEdit={permissions.edit} />
        </div>
      }
      main={
        <RecordTabs
          notes={<NoteComposer entity="leads" recordId={lead.id} />}
          timeline={<Timeline items={timeline} />}
        />
      }
    />
  );
}
