"use client";

import Link from "next/link";
import type { RecordColumn } from "@/components/records/data-table";
import { LabelChip } from "@/components/records/label-chip";
import { formatDate, formatPhone } from "@/lib/records/format";
import type { PersonRow } from "@/lib/persons/queries";
import { recordHref } from "@/lib/records/types";

const dash = <span className="text-muted-foreground">-</span>;

export const personColumns: RecordColumn<PersonRow>[] = [
  {
    id: "name",
    header: "Nome",
    sortKey: "full_name",
    cell: (r) => (
      <Link href={recordHref("persons", r.companySlug, r.id)} className="font-medium hover:underline">
        {r.fullName}
      </Link>
    ),
  },
  { id: "jobTitle", header: "Cargo", sortKey: "job_title", cell: (r) => r.jobTitle ?? dash },
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
  { id: "email", header: "E-mail", cell: (r) => r.primaryEmail ?? dash },
  { id: "phone", header: "Telefone", cell: (r) => (r.primaryPhone ? formatPhone(r.primaryPhone) : dash) },
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
  { id: "createdAt", header: "Criada em", sortKey: "created_at", cell: (r) => formatDate(r.createdAt) },
  { id: "company", header: "Empresa", companyOnly: true, cell: (r) => r.companyName },
];
