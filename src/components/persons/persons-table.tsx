"use client";

import { DataTable } from "@/components/records/data-table";
import type { PersonRow } from "@/lib/persons/queries";
import { recordHref, type ListQuery } from "@/lib/records/types";
import { personColumns } from "./person-columns";

export function PersonsTable({
  rows,
  total,
  query,
  allCompanies,
}: {
  rows: PersonRow[];
  total: number;
  query: ListQuery;
  allCompanies: boolean;
}) {
  return (
    <DataTable
      columns={personColumns}
      rows={rows}
      total={total}
      query={query}
      entity="persons"
      companyColumn={allCompanies}
      rowHref={(r) => recordHref("persons", r.companySlug, r.id)}
    />
  );
}
