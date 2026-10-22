import { Suspense } from "react";
import { notFound } from "next/navigation";
import { OrganizationsTable } from "@/components/organizations/organizations-table";
import { OrganizationsToolbar } from "@/components/organizations/organizations-toolbar";
import type { CreatableCompany } from "@/components/organizations/create-organization-dialog";
import { Pagination } from "@/components/records/pagination";
import { TrashLink } from "@/components/records/trash-link";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { ORGANIZATION_SORTS, listOrganizations } from "@/lib/organizations/queries";
import { listActiveCustomFieldDefs, listCompanyLabels } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";
import { parseListQuery } from "@/lib/records/query";

export const instant = false;

export default async function OrganizationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ empresa }, rawParams, profile, companies] = await Promise.all([
    params,
    searchParams,
    requireUser(),
    getAccessibleCompanies(),
  ]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(rawParams)) {
    for (const item of Array.isArray(v) ? v : v === undefined ? [] : [v]) sp.append(k, item);
  }
  const query = parseListQuery(sp, ORGANIZATION_SORTS);

  const scoped = scope.kind === "all" ? companies : [scope.company];
  const [result, perCompany] = await Promise.all([
    listOrganizations(scope, query),
    Promise.all(
      scoped.map(async (company) => {
        const [permissions, owners, labels, defs] = await Promise.all([
          getEntityPermissions(company.id, "organizations"),
          listAssignableOwners(company.id),
          listCompanyLabels(company.id),
          listActiveCustomFieldDefs(company.id, "organizations"),
        ]);
        return { company, permissions, owners, labels, defs };
      }),
    ),
  ]);

  const multi = scoped.length > 1;
  const ownerMap = new Map<string, string>();
  for (const c of perCompany) for (const o of c.owners) ownerMap.set(o.id, o.fullName);
  const filterOptions = {
    owners: [...ownerMap].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    labels: perCompany.flatMap((c) =>
      c.labels.map((l) => ({ value: l.id, label: multi ? `${l.name} (${c.company.name})` : l.name })),
    ),
  };
  const creatable: CreatableCompany[] = perCompany
    .filter((c) => c.permissions.create)
    .map((c) => ({ company: c.company, defs: c.defs, owners: c.owners }));
  const canTrash = perCompany.some((c) => c.permissions.delete);
  const canExport = perCompany.some((c) => c.permissions.export);
  const scopeSlug = scope.kind === "all" ? "todas" : scope.company.slug;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Organizações</h1>
      <OrganizationsToolbar
        scopeSlug={scopeSlug}
        allCompanies={scope.kind === "all"}
        filterOptions={filterOptions}
        creatable={creatable}
        canExport={canExport}
      />
      <Suspense>
        <OrganizationsTable
          rows={result.rows}
          total={result.total}
          query={query}
          allCompanies={scope.kind === "all"}
        />
        <Pagination total={result.total} page={query.page} />
      </Suspense>
      {canTrash ? <TrashLink scopeSlug={scopeSlug} tab="organizacoes" /> : null}
    </div>
  );
}
