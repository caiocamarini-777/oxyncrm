"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { ListFilters, type ListFilterOptions } from "@/components/records/list-filters";
import { buttonVariants } from "@/components/ui/button";
import { CreatePersonDialog, type CreatablePersonCompany } from "./create-person-dialog";

function ExportLink({ scopeSlug }: { scopeSlug: string }) {
  const params = useSearchParams();
  const next = new URLSearchParams(params.toString());
  next.delete("page");
  const qs = next.toString();
  return (
    <a
      href={`/${scopeSlug}/exportar/pessoas${qs ? `?${qs}` : ""}`}
      className={buttonVariants({ variant: "outline" })}
    >
      <Download /> Exportar CSV
    </a>
  );
}

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
            <ExportLink scopeSlug={scopeSlug} />
          </Suspense>
        ) : null}
        {creatable.length > 0 ? <CreatePersonDialog options={creatable} askCompany={allCompanies} /> : null}
      </div>
    </div>
  );
}
