"use client";

import Link from "next/link";
import type { RecordColumn } from "@/components/records/data-table";
import { NextActivityBadge } from "@/components/activities/next-activity-badge";
import { LabelChip } from "@/components/records/label-chip";
import { StatusTabs } from "@/components/records/status-tabs";
import type { DealRow } from "@/lib/deals/queries";
import { leadAgeLabel } from "@/lib/leads/schema";
import { formatDate, formatMoney } from "@/lib/records/format";
import { recordHref } from "@/lib/records/types";

const dash = <span className="text-muted-foreground">-</span>;

export const DEAL_STATUS_LABELS: Record<string, string> = { open: "Aberto", won: "Ganho", lost: "Perdido" };

const TABS = [
  { status: "open", label: "Abertos" },
  { status: "won", label: "Ganhos" },
  { status: "lost", label: "Perdidos" },
];

/** Abas por status dos negócios: Abertos por padrão. */
export function DealStatusTabs() {
  return <StatusTabs tabs={TABS} ariaLabel="Status dos negócios" />;
}

export const dealColumns: RecordColumn<DealRow>[] = [
  {
    id: "title",
    header: "Título",
    sortKey: "title",
    cell: (r) => (
      <Link href={recordHref("deals", r.companySlug, r.id)} className="font-medium hover:underline">
        {r.title}
      </Link>
    ),
  },
  {
    id: "organization",
    header: "Organização",
    cell: (r) =>
      r.organization ? (
        <Link href={recordHref("organizations", r.companySlug, r.organization.id)} className="hover:underline">
          {r.organization.name}
        </Link>
      ) : (
        dash
      ),
  },
  {
    id: "person",
    header: "Pessoa",
    cell: (r) =>
      r.person ? (
        <Link href={recordHref("persons", r.companySlug, r.person.id)} className="hover:underline">
          {r.person.name}
        </Link>
      ) : (
        dash
      ),
  },
  { id: "stage", header: "Etapa", cell: (r) => r.stageName || dash },
  { id: "status", header: "Status", cell: (r) => DEAL_STATUS_LABELS[r.status] ?? r.status },
  { id: "total", header: "Valor total", sortKey: "contract_value", cell: (r) => formatMoney(r.totalValue) },
  { id: "mrr", header: "MRR", cell: (r) => formatMoney(r.mrr) },
  { id: "setup", header: "Setup", cell: (r) => formatMoney(r.setupTotal) },
  {
    id: "closeDate",
    header: "Fechamento",
    sortKey: "expected_close_date",
    cell: (r) => (r.expectedCloseDate ? formatDate(r.expectedCloseDate) : dash),
  },
  {
    id: "nextActivity",
    header: "Próxima atividade",
    cell: (r) => (r.status === "open" ? <NextActivityBadge next={r.nextActivity} /> : dash),
  },
  { id: "owner", header: "Responsável", cell: (r) => r.ownerName || dash },
  {
    id: "labels",
    header: "Etiquetas",
    cell: (r) =>
      r.labels.length === 0 ? (
        dash
      ) : (
        <span className="flex flex-wrap gap-1">
          {r.labels.map((l) => (
            <LabelChip key={l.id} color={l.color} name={l.name} />
          ))}
        </span>
      ),
  },
  { id: "age", header: "Idade", cell: (r) => leadAgeLabel(r.createdAt) },
  { id: "createdAt", header: "Criado em", sortKey: "created_at", cell: (r) => formatDate(r.createdAt) },
  { id: "company", header: "Empresa", companyOnly: true, cell: (r) => r.companyName },
];
