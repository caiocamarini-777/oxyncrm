import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrganizationDetail } from "@/lib/organizations/queries";
import { recordHref } from "@/lib/records/types";

export function OrganizationPersons({ organization }: { organization: OrganizationDetail }) {
  return (
    <Card data-testid="organization-persons">
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">
          Pessoas ({organization.persons.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {organization.persons.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma pessoa vinculada.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {organization.persons.map((p) => (
              <li key={p.id} className="text-sm">
                <Link href={recordHref("persons", organization.companySlug, p.id)} className="font-medium hover:underline">
                  {p.fullName}
                </Link>
                {p.jobTitle ? <span className="block text-xs text-muted-foreground">{p.jobTitle}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
