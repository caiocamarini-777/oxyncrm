"use client";

import Link from "next/link";
import type { RecordColumn } from "@/components/records/data-table";
import { NextActivityBadge } from "@/components/activities/next-activity-badge";
import { LabelChip } from "@/components/records/label-chip";
import { leadAgeLabel } from "@/lib/leads/schema";
import type { LeadRow } from "@/lib/leads/queries";
import { formatDate, formatMoney } from "@/lib/records/format";
import { recordHref } from "@/lib/records/types";

const dash = <span className="text-muted-foreground">-</span>;

export const leadColumns: RecordColumn<LeadRow>[] = [
  {
    id: "title",
    header: "Título",
    sortKey: "title",
    cell: (r) => (
      <Link href={recordHref("leads", r.companySlug, r.id)} className="font-medium hover:underline">
        {r.title}
      </Link>
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
  { id: "source", header: "Origem", cell: (r) => r.sourceName ?? dash },
  { id: "reason", header: "Motivo", defaultHidden: true, cell: (r) => r.reasonName ?? dash },
  {
    id: "value",
    header: "Valor estimado",
    sortKey: "estimated_value",
    cell: (r) => (r.estimatedValue === null ? dash : formatMoney(r.estimatedValue)),
  },
  {
    id: "nextActivity",
    header: "Próxima atividade",
    cell: (r) => (r.status === "open" ? <NextActivityBadge next={r.nextActivity} /> : dash),
  },
  { id: "lastChannel", header: "Último canal", cell: (r) => r.lastChannel ?? dash },
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
  { id: "createdAt", header: "Criada em", sortKey: "created_at", cell: (r) => formatDate(r.createdAt) },
  { id: "company", header: "Empresa", companyOnly: true, cell: (r) => r.companyName },
];
