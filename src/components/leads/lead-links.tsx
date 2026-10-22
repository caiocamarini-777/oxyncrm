import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LeadDetail, LeadLink } from "@/lib/leads/queries";
import { formatMoney } from "@/lib/records/format";
import { recordHref } from "@/lib/records/types";

function LinkValue({ testId, link, href }: { testId: string; link: LeadLink | null; href: (id: string) => string }) {
  if (!link) return <span className="text-muted-foreground">Não informada</span>;
  if (link.state === "ok") {
    return (
      <Link data-testid={testId} href={href(link.id)} className="font-medium text-primary hover:underline">
        {link.name}
      </Link>
    );
  }
  return (
    <span data-testid={testId} className="text-muted-foreground">
      {link.state === "trashed" ? `${link.name} (na lixeira)` : "(sem acesso)"}
    </span>
  );
}

/** Resumo do lead: pessoa e organização como links, origem e valor. */
export function LeadLinks({ lead }: { lead: LeadDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Resumo</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Pessoa</dt>
          <dd>
            <LinkValue testId="lead-person-link" link={lead.person} href={(id) => recordHref("persons", lead.companySlug, id)} />
          </dd>
          <dt className="text-muted-foreground">Organização</dt>
          <dd>
            <LinkValue
              testId="lead-organization-link"
              link={lead.organization}
              href={(id) => recordHref("organizations", lead.companySlug, id)}
            />
          </dd>
          <dt className="text-muted-foreground">Origem</dt>
          <dd data-testid="lead-source">{lead.sourceName ?? <span className="text-muted-foreground">Não informada</span>}</dd>
          <dt className="text-muted-foreground">Valor</dt>
          <dd>{lead.estimatedValue === null ? <span className="text-muted-foreground">Não informado</span> : formatMoney(lead.estimatedValue)}</dd>
          {lead.status === "disqualified" ? (
            <>
              <dt className="text-muted-foreground">Motivo</dt>
              <dd data-testid="lead-reason">{lead.reasonName ?? "-"}</dd>
              {lead.disqualificationNote ? (
                <>
                  <dt className="text-muted-foreground">Observação</dt>
                  <dd className="whitespace-pre-wrap">{lead.disqualificationNote}</dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}
