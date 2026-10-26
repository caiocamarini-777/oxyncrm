import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/records/pagination";
import { TrashTable } from "@/components/trash/trash-table";
import { TrashTabs } from "@/components/trash/trash-tabs";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getEntityPermissions } from "@/lib/records/permissions";
import { TRASH_TABS } from "@/lib/trash/tabs";
import { listTrash } from "@/lib/trash/queries";

export const instant = false;

export default async function TrashPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ empresa }, raw, profile, companies] = await Promise.all([
    params,
    searchParams,
    requireUser(),
    getAccessibleCompanies(),
  ]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  const scoped = scope.kind === "all" ? companies : [scope.company];
  const perms = await Promise.all(
    scoped.map(async (c) => ({ id: c.id, canDelete: (await getEntityPermissions(c.id, "leads")).delete })),
  );
  const deletableCompanyIds = perms.filter((p) => p.canDelete).map((p) => p.id);

  const heading = <h1 className="font-heading text-2xl font-semibold">Lixeira</h1>;
  if (deletableCompanyIds.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {heading}
        <p className="rounded-lg border p-8 text-center text-muted-foreground">
          Você não tem permissão para ver a lixeira.
        </p>
      </div>
    );
  }

  const aba = Array.isArray(raw.aba) ? raw.aba[0] : raw.aba;
  const tab = TRASH_TABS.find((t) => t.key === aba) ?? TRASH_TABS[0];
  const rawPage = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const result = await listTrash(tab.entity, scope, page);
  const scopeSlug = scope.kind === "all" ? "todas" : scope.company.slug;

  return (
    <div className="flex flex-col gap-4">
      {heading}
      <p className="text-sm text-muted-foreground">
        Registros excluídos ficam na lixeira por 30 dias e depois são removidos de vez.
      </p>
      <TrashTabs scopeSlug={scopeSlug} active={tab.key} />
      <TrashTable
        entity={tab.entity}
        rows={result.rows}
        allCompanies={scope.kind === "all"}
        deletableCompanyIds={deletableCompanyIds}
        isSuperAdmin={profile.isSuperAdmin}
      />
      <Suspense>
        <Pagination total={result.total} page={result.page} />
      </Suspense>
    </div>
  );
}
