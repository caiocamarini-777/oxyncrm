"use client";

import { DataTable } from "@/components/records/data-table";
import type { LeadRow } from "@/lib/leads/queries";
import { recordHref, type ListQuery } from "@/lib/records/types";
import { leadColumns } from "./lead-columns";

export function LeadsTable({
  rows,
  total,
  query,
  allCompanies,
}: {
  rows: LeadRow[];
  total: number;
  query: ListQuery;
  allCompanies: boolean;
}) {
  return (
    <DataTable
      columns={leadColumns}
      rows={rows}
      total={total}
      query={query}
      entity="leads"
      companyColumn={allCompanies}
      rowHref={(r) => recordHref("leads", r.companySlug, r.id)}
    />
  );
}
