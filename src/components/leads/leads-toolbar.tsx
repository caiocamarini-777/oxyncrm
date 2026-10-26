"use client";

import { Suspense } from "react";
import { ExportLink } from "@/components/records/export-link";
import { ListFilters, type ListFilterOptions } from "@/components/records/list-filters";
import { CreateLeadDialog, type CreatableLeadCompany } from "./create-lead-dialog";

export function LeadsToolbar({
  scopeSlug,
  allCompanies,
  filterOptions,
  creatable,
  canExport,
}: {
  scopeSlug: string;
  allCompanies: boolean;
  filterOptions: ListFilterOptions;
  creatable: CreatableLeadCompany[];
  canExport: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Suspense>
        <ListFilters entity="leads" options={filterOptions} />
      </Suspense>
      <div className="flex items-center gap-2">
        {canExport ? (
          <Suspense>
            <ExportLink scopeSlug={scopeSlug} segment="leads" />
          </Suspense>
        ) : null}
        {creatable.length > 0 ? <CreateLeadDialog options={creatable} askCompany={allCompanies} /> : null}
      </div>
    </div>
  );
}
