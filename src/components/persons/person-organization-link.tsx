import Link from "next/link";
import type { PersonOrganization } from "@/lib/persons/queries";
import { recordHref } from "@/lib/records/types";

/** Organização vinculada: link só quando o usuário pode abri-la. */
export function PersonOrganizationLink({
  organization,
  companySlug,
}: {
  organization: PersonOrganization | null;
  companySlug: string;
}) {
  if (!organization) return null;
  if (organization.state === "ok") {
    return (
      <Link
        data-testid="person-organization-link"
        href={recordHref("organizations", companySlug, organization.id)}
        className="text-sm font-medium text-primary hover:underline"
      >
        {organization.name}
      </Link>
    );
  }
  const note = organization.state === "trashed" ? "(na lixeira)" : "(sem acesso)";
  return (
    <span data-testid="person-organization-link" className="text-sm text-muted-foreground">
      {organization.name ? `${organization.name} ` : ""}
      {note}
    </span>
  );
}
