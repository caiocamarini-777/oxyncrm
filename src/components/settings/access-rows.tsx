"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type NamedOption = { id: string; name: string };
export type AccessDraft = { companyId: string; roleId: string };

export function AccessRows({
  value,
  onChange,
  companies,
  roles,
  error,
}: {
  value: AccessDraft[];
  onChange: (next: AccessDraft[]) => void;
  companies: NamedOption[];
  roles: NamedOption[];
  error?: string | null;
}) {
  const used = new Set(value.map((r) => r.companyId).filter(Boolean));
  const canAdd = value.length < companies.length;

  function patch(index: number, part: Partial<AccessDraft>) {
    onChange(value.map((r, i) => (i === index ? { ...r, ...part } : r)));
  }

  return (
    <div className="flex flex-col gap-2">
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2" data-testid="access-row">
          <Select value={row.companyId} onValueChange={(v) => patch(i, { companyId: v })}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="Empresa">
              <SelectValue placeholder="Empresa" />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id} disabled={used.has(c.id) && c.id !== row.companyId}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={row.roleId} onValueChange={(v) => patch(i, { roleId: v })}>
            <SelectTrigger className="min-w-0 flex-1" aria-label="Papel">
              <SelectValue placeholder="Papel" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remover empresa"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canAdd}
          onClick={() => onChange([...value, { companyId: "", roleId: "" }])}
        >
          <PlusIcon /> Adicionar empresa
        </Button>
      </div>
    </div>
  );
}

export function TeamPicker({
  teams,
  selected,
  onChange,
}: {
  teams: NamedOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  if (teams.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma equipe cadastrada.</p>;
  }
  return (
    <ul className="max-h-40 overflow-y-auto rounded-md border">
      {teams.map((t) => (
        <li key={t.id}>
          <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-brand)]"
              checked={selected.has(t.id)}
              aria-label={`Equipe ${t.name}`}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(t.id);
                else next.delete(t.id);
                onChange(next);
              }}
            />
            {t.name}
          </label>
        </li>
      ))}
    </ul>
  );
}
