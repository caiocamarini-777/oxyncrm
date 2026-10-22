"use client";

import Link from "next/link";
import type { RecordColumn } from "@/components/records/data-table";
import { LabelChip } from "@/components/records/label-chip";
import { formatCnpj } from "@/lib/companies/cnpj";
import type { OrganizationRow } from "@/lib/organizations/queries";
import { formatDate } from "@/lib/records/format";
import { recordHref } from "@/lib/records/types";

const dash = <span className="text-muted-foreground">-</span>;

export const organizationColumns: RecordColumn<OrganizationRow>[] = [
  {
    id: "name",
    header: "Nome",
    sortKey: "name",
    cell: (r) => (
      <Link href={recordHref("organizations", r.companySlug, r.id)} className="font-medium hover:underline">
        {r.name}
      </Link>
    ),
  },
  { id: "cnpj", header: "CNPJ", sortKey: "cnpj", cell: (r) => (r.cnpj ? formatCnpj(r.cnpj) : dash) },
  { id: "domain", header: "Domínio", sortKey: "domain", cell: (r) => r.domain ?? dash },
  { id: "segment", header: "Segmento", sortKey: "segment", cell: (r) => r.segment ?? dash },
  { id: "owner", header: "Responsável", cell: (r) => r.ownerName || dash },
  { id: "persons", header: "Pessoas", cell: (r) => r.personsCount },
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
