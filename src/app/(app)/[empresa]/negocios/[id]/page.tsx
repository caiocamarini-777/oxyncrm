import Link from "next/link";
import { notFound } from "next/navigation";
import { ContractForm } from "@/components/deals/contract-form";
import { DealActions } from "@/components/deals/deal-actions";
import { DealForm } from "@/components/deals/deal-form";
import { DealItems } from "@/components/deals/deal-items";
import { RevenueTable } from "@/components/deals/revenue-table";
import { StageBar } from "@/components/deals/stage-bar";
import { NoteComposer } from "@/components/records/note-composer";
import { RecordHeader } from "@/components/records/record-header";
import { RecordLayout } from "@/components/records/record-layout";
import { RecordTabs } from "@/components/records/record-tabs";
import { Timeline } from "@/components/records/timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { daysSince } from "@/lib/deals/kanban";
import { getDeal, listActiveLostReasons, listActiveProducts } from "@/lib/deals/queries";
import { listActiveCustomFieldDefs, listCompanyLabels } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";
import { getTimeline } from "@/lib/timeline/queries";

export const instant = false;

export default async function DealPage({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  const [{ empresa, id }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  // Inexistente, de outra empresa ou sem acesso: sempre o mesmo 404.
  const deal = await getDeal(id);
  if (!deal) notFound();
  if (scope.kind === "company" && scope.company.id !== deal.companyId) notFound();

  const [timeline, owners, labels, defs, permissions, products, reasons] = await Promise.all([
    getTimeline("deals", deal.id),
    listAssignableOwners(deal.companyId),
    listCompanyLabels(deal.companyId),
    listActiveCustomFieldDefs(deal.companyId, "deals"),
    getEntityPermissions(deal.companyId, "deals"),
    listActiveProducts(deal.companyId),
    listActiveLostReasons(deal.companyId),
  ]);

  const daysInStage = daysSince(deal.stageEnteredAt);
  const stages = deal.stages.filter((s) => !s.archived || s.id === deal.stageId).map((s) => ({ id: s.id, name: s.name }));
  // Recomeça o formulário de dados quando o servidor devolve outros valores (ex.: diálogo de obrigatórios).
  const formKey = JSON.stringify([
    deal.title,
    deal.personId,
    deal.organizationId,
    deal.estimatedValue,
    deal.expectedCloseDate,
    deal.customFields,
  ]);
  const dealHref = `/${empresa}/negocios/${deal.id}`;

  return (
    <RecordLayout
      header={
        <div className="flex flex-col gap-4">
          <RecordHeader
            entity="deals"
            noun={{
              singular: "negócio",
              trashedToast: "Negócio movido para a lixeira.",
              trashDescription: "O negócio some do funil e pode ser restaurado pela lixeira por 30 dias.",
            }}
            actions={
              <DealActions
                dealId={deal.id}
                title={deal.title}
                status={deal.status}
                reasons={reasons}
                canEdit={permissions.edit}
              />
            }
            id={deal.id}
            companyId={deal.companyId}
            companyName={deal.companyName}
            listHref={`/${empresa}/negocios`}
            name={deal.title}
            ownerId={deal.ownerId}
            owners={owners}
            labels={labels}
            labelIds={deal.labelIds}
            canEdit={permissions.edit}
            canDelete={permissions.delete}
            canReassign={permissions.reassign}
          />
          <StageBar
            dealId={deal.id}
            companyId={deal.companyId}
            dealHref={dealHref}
            stages={stages}
            currentStageId={deal.stageId}
            daysInStage={daysInStage}
            canMove={permissions.edit && deal.status === "open"}
            defs={defs}
            owners={owners}
          />
          {deal.status === "lost" ? (
            <p data-testid="lost-info" className="text-sm text-muted-foreground">
              Motivo da perda: {deal.lostReasonName ?? "-"}
              {deal.lostNote ? `. ${deal.lostNote}` : ""}
            </p>
          ) : null}
          {deal.leadId ? (
            <p className="text-sm text-muted-foreground">
              Originado de um{" "}
              <Link href={`/${empresa}/leads/${deal.leadId}`} className="text-primary hover:underline">
                lead
              </Link>
              .
            </p>
          ) : null}
        </div>
      }
      details={
        <div className="flex flex-col gap-4">
          <DealForm key={formKey} deal={deal} defs={defs} owners={owners} canEdit={permissions.edit} />
          <DealItems deal={deal} products={products} canEdit={permissions.edit} />
          <ContractForm deal={deal} canEdit={permissions.edit} />
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Cronograma</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueTable rows={deal.schedule} />
            </CardContent>
          </Card>
        </div>
      }
      main={
        <RecordTabs
          notes={<NoteComposer entity="deals" recordId={deal.id} />}
          timeline={<Timeline items={timeline} />}
        />
      }
    />
  );
}
