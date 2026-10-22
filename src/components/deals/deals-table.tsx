"use client";

import { DataTable } from "@/components/records/data-table";
import type { DealRow } from "@/lib/deals/queries";
import { recordHref, type ListQuery } from "@/lib/records/types";
import { dealColumns } from "./deal-columns";

export function DealsTable({
  rows,
  total,
  query,
  allCompanies,
}: {
  rows: DealRow[];
  total: number;
  query: ListQuery;
  allCompanies: boolean;
}) {
  return (
    <DataTable
      columns={dealColumns}
      rows={rows}
      total={total}
      query={query}
      entity="deals"
      companyColumn={allCompanies}
      rowHref={(r) => recordHref("deals", r.companySlug, r.id)}
    />
  );
}
