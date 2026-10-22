import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { CreatablePersonCompany } from "@/components/persons/create-person-dialog";
import { PersonsTable } from "@/components/persons/persons-table";
import { PersonsToolbar } from "@/components/persons/persons-toolbar";
import { Pagination } from "@/components/records/pagination";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { PERSON_SORTS, listPersons } from "@/lib/persons/queries";
import { listActiveCustomFieldDefs, listCompanyLabels } from "@/lib/records/lookups";
import { listAssignableOwners } from "@/lib/records/owners";
import { getEntityPermissions } from "@/lib/records/permissions";
import { parseListQuery } from "@/lib/records/query";

export const instant = false;

export default async function PersonsPage({
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
  const query = parseListQuery(sp, PERSON_SORTS);

  const scoped = scope.kind === "all" ? companies : [scope.company];
  const [result, perCompany] = await Promise.all([
    listPersons(scope, query),
    Promise.all(
      scoped.map(async (company) => {
        const [permissions, orgPermissions, owners, labels, defs] = await Promise.all([
          getEntityPermissions(company.id, "persons"),
          getEntityPermissions(company.id, "organizations"),
          listAssignableOwners(company.id),
          listCompanyLabels(company.id),
          listActiveCustomFieldDefs(company.id, "persons"),
        ]);
        return { company, permissions, orgPermissions, owners, labels, defs };
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
  const creatable: CreatablePersonCompany[] = perCompany
    .filter((c) => c.permissions.create)
    .map((c) => ({
      company: c.company,
      defs: c.defs,
      owners: c.owners,
      canCreateOrganization: c.orgPermissions.create,
    }));
  const canExport = perCompany.some((c) => c.permissions.export);
  const scopeSlug = scope.kind === "all" ? "todas" : scope.company.slug;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Pessoas</h1>
      <PersonsToolbar
        scopeSlug={scopeSlug}
        allCompanies={scope.kind === "all"}
        filterOptions={filterOptions}
        creatable={creatable}
        canExport={canExport}
      />
      <Suspense>
        <PersonsTable rows={result.rows} total={result.total} query={query} allCompanies={scope.kind === "all"} />
        <Pagination total={result.total} page={query.page} />
      </Suspense>
    </div>
  );
}
