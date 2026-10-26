"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LabelColor } from "@/lib/custom-fields/schema";
import { addRecordLabel, removeRecordLabel } from "@/lib/records/actions";
import type { RecordEntity } from "@/lib/records/types";
import { LabelChip } from "./label-chip";

export type LabelOption = { id: string; name: string; color: LabelColor };

/** `options` são as etiquetas da empresa; `value` são os ids aplicados ao registro. */
export function LabelPicker({
  companyId,
  entity,
  recordId,
  options,
  value,
  canEdit,
}: {
  companyId: string;
  entity: RecordEntity;
  recordId: string;
  options: LabelOption[];
  value: string[];
  canEdit: boolean;
}) {
  const [applied, setApplied] = useState<string[]>(value);
  const [, start] = useTransition();
  const selected = options.filter((o) => applied.includes(o.id));
  const rest = options.filter((o) => !applied.includes(o.id));

  function add(id: string) {
    setApplied((a) => [...a, id]);
    start(async () => {
      const res = await addRecordLabel(entity, recordId, id);
      if (!res.ok) {
        setApplied((a) => a.filter((x) => x !== id));
        toast.error(res.error);
      }
    });
  }

  function remove(id: string) {
    setApplied((a) => a.filter((x) => x !== id));
    start(async () => {
      const res = await removeRecordLabel(entity, recordId, id);
      if (!res.ok) {
        setApplied((a) => [...a, id]);
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-company={companyId}>
      {selected.map((l) => (
        <span key={l.id} className="inline-flex items-center gap-0.5">
          <LabelChip color={l.color} name={l.name} />
          {canEdit ? (
            <button
              type="button"
              aria-label={`Remover etiqueta ${l.name}`}
              onClick={() => remove(l.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      {selected.length === 0 && !canEdit ? (
        <span className="text-sm text-muted-foreground">Sem etiquetas</span>
      ) : null}
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" disabled={rest.length === 0}>
              <Plus /> Etiqueta
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {rest.map((l) => (
              <DropdownMenuItem key={l.id} onSelect={() => add(l.id)}>
                <LabelChip color={l.color} name={l.name} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
