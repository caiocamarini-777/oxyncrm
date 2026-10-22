"use client";

import { Suspense } from "react";
import { ExportLink } from "@/components/records/export-link";
import { ListFilters, type ListFilterOptions } from "@/components/records/list-filters";
import { CreatePersonDialog, type CreatablePersonCompany } from "./create-person-dialog";

export function PersonsToolbar({
  scopeSlug,
  allCompanies,
  filterOptions,
  creatable,
  canExport,
}: {
  scopeSlug: string;
  allCompanies: boolean;
  filterOptions: ListFilterOptions;
  creatable: CreatablePersonCompany[];
  canExport: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Suspense>
        <ListFilters entity="persons" options={filterOptions} />
      </Suspense>
      <div className="flex items-center gap-2">
        {canExport ? (
          <Suspense>
            <ExportLink scopeSlug={scopeSlug} segment="pessoas" />
          </Suspense>
        ) : null}
        {creatable.length > 0 ? <CreatePersonDialog options={creatable} askCompany={allCompanies} /> : null}
      </div>
    </div>
  );
}
