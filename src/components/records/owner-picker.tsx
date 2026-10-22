"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/db-errors";
import type { AssignableOwner } from "@/lib/records/types";

/**
 * Troca de responsável. `owners` vem de `listAssignableOwners(companyId)` (o kit não busca dados).
 * Inativos não são oferecidos; o atual aparece com "(inativo)" se for o caso.
 */
export function OwnerPicker({
  companyId,
  owners,
  value,
  canReassign,
  onChange,
}: {
  companyId: string;
  owners: AssignableOwner[];
  value: string;
  canReassign: boolean;
  onChange: (ownerId: string) => Promise<ActionResult | void> | void;
}) {
  const [pending, setPending] = useState(false);
  const current = owners.find((o) => o.id === value);
  const options = owners.filter((o) => o.active && o.id !== value);

  async function change(next: string) {
    if (next === value) return;
    setPending(true);
    try {
      const res = await onChange(next);
      if (res && !res.ok) toast.error(res.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <select
      data-company={companyId}
      aria-label="Responsável"
      value={value}
      disabled={!canReassign || pending}
      onChange={(e) => void change(e.target.value)}
      className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
    >
      <option value={value}>
        {current ? `${current.fullName}${current.active ? "" : " (inativo)"}` : "Sem responsável"}
      </option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.fullName}
        </option>
      ))}
    </select>
  );
}
