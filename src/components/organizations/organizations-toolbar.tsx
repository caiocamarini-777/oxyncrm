"use client";

import { Suspense } from "react";
import { ExportLink } from "@/components/records/export-link";
import { ListFilters, type ListFilterOptions } from "@/components/records/list-filters";
import { CreateOrganizationDialog, type CreatableCompany } from "./create-organization-dialog";

export function OrganizationsToolbar({
  scopeSlug,
  allCompanies,
  filterOptions,
  creatable,
  canExport,
}: {
  scopeSlug: string;
  allCompanies: boolean;
  filterOptions: ListFilterOptions;
  creatable: CreatableCompany[];
  canExport: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Suspense>
        <ListFilters entity="organizations" options={filterOptions} />
      </Suspense>
      <div className="flex items-center gap-2">
        {canExport ? (
          <Suspense>
            <ExportLink scopeSlug={scopeSlug} segment="organizacoes" />
          </Suspense>
        ) : null}
        {creatable.length > 0 ? <CreateOrganizationDialog options={creatable} askCompany={allCompanies} /> : null}
      </div>
    </div>
  );
}
