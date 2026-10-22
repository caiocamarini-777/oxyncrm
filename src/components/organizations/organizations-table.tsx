"use client";

import { DataTable } from "@/components/records/data-table";
import type { OrganizationRow } from "@/lib/organizations/queries";
import { recordHref, type ListQuery } from "@/lib/records/types";
import { organizationColumns } from "./organization-columns";

export function OrganizationsTable({
  rows,
  total,
  query,
  allCompanies,
}: {
  rows: OrganizationRow[];
  total: number;
  query: ListQuery;
  allCompanies: boolean;
}) {
  return (
    <DataTable
      columns={organizationColumns}
      rows={rows}
      total={total}
      query={query}
      entity="organizations"
      companyColumn={allCompanies}
      rowHref={(r) => recordHref("organizations", r.companySlug, r.id)}
    />
  );
}
