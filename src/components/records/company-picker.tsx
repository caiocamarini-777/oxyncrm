"use client";

import { Button } from "@/components/ui/button";
import type { CompanySummary } from "@/lib/companies/pure";
import type { RecordEntity } from "@/lib/records/types";

/**
 * Escolha da empresa ao criar na visão "Todas". `companies` já vem filtrada no servidor com
 * `listCompaniesWithCreate` (papel com `create` para a entidade; admin geral: todas).
 */
export function CompanyPicker({
  entity,
  companies,
  onSelect,
}: {
  entity: RecordEntity;
  companies: CompanySummary[];
  onSelect: (company: CompanySummary) => void;
}) {
  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">Você não pode criar registros em nenhuma empresa.</p>;
  }
  return (
    <ul className="flex flex-col gap-1" data-entity={entity} aria-label="Escolha a empresa">
      {companies.map((c) => (
        <li key={c.id}>
          <Button variant="outline" className="w-full justify-start" onClick={() => onSelect(c)}>
            {c.name}
          </Button>
        </li>
      ))}
    </ul>
  );
}
