"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOrganization } from "@/lib/organizations/actions";
import { searchOrganizations } from "@/lib/persons/actions";

export type OrganizationOption = { id: string; name: string };

/**
 * Organização pesquisável (só da empresa informada). "Criar organização" cria o registro
 * na hora; se o salvamento da pessoa falhar depois, a organização continua existindo.
 */
export function OrganizationCombobox({
  companyId,
  value,
  onChange,
  canCreate,
}: {
  companyId: string;
  value: OrganizationOption | null;
  onChange: (value: OrganizationOption | null) => void;
  canCreate: boolean;
}) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<OrganizationOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await searchOrganizations(companyId, term).catch(() => null);
      if (!cancelled && res?.ok) setResults(res.data);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, open, companyId]);

  async function create() {
    setBusy(true);
    setError(null);
    const res = await createOrganization(companyId, { name: newName });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChange({ id: res.data.id, name: newName.trim() });
    setCreating(false);
    setNewName("");
    setOpen(false);
    setTerm("");
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span data-testid="person-organization" className="flex h-8 flex-1 items-center rounded-md border border-input px-2 text-sm">
          {value.name}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label="Remover organização" onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id="person-organization-search"
        role="combobox"
        aria-expanded={open}
        aria-controls="person-organization-list"
        aria-label="Organização"
        placeholder="Buscar organização"
        value={term}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
      />
      {open ? (
        <ul id="person-organization-list" role="listbox" className="max-h-40 overflow-y-auto rounded-md border text-sm">
          {results.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground">Nenhuma organização encontrada.</li>
          ) : (
            results.map((o) => (
              <li key={o.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                    setTerm("");
                  }}
                >
                  {o.name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {canCreate ? (
        creating ? (
          <div className="flex flex-col gap-2 rounded-md border p-2">
            <Input
              aria-label="Nome da nova organização"
              value={newName}
              maxLength={200}
              onChange={(e) => setNewName(e.target.value)}
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" disabled={busy || !newName.trim()} onClick={create}>
                {busy ? "Criando..." : "Criar e vincular"}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              setNewName(term);
              setCreating(true);
            }}
          >
            Criar organização
          </Button>
        )
      ) : null}
    </div>
  );
}
