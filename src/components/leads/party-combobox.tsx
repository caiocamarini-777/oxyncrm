"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchPersonsByName } from "@/lib/leads/actions";
import { searchOrganizations } from "@/lib/persons/actions";

/** `id: null` = ainda não existe; será criada junto com o lead. */
export type PartyValue = { id: string | null; name: string };

const NOUN = {
  person: { label: "Pessoa", lower: "pessoa", none: "Nenhuma pessoa encontrada.", create: "Criar pessoa nova" },
  organization: {
    label: "Organização",
    lower: "organização",
    none: "Nenhuma organização encontrada.",
    create: "Criar organização nova",
  },
} as const;

/** Busca pessoa/organização da empresa ou aceita um nome novo (criado só ao salvar o lead). */
export function PartyCombobox({
  kind,
  companyId,
  value,
  onChange,
  canCreate,
  readOnly = false,
}: {
  kind: "person" | "organization";
  companyId: string;
  value: PartyValue | null;
  onChange: (value: PartyValue | null) => void;
  canCreate: boolean;
  readOnly?: boolean;
}) {
  const noun = NOUN[kind];
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await (kind === "person" ? searchPersonsByName : searchOrganizations)(companyId, term).catch(
        () => null,
      );
      if (!cancelled && res?.ok) setResults(res.data);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, open, companyId, kind]);

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span
          data-testid={`lead-${kind}-value`}
          className="flex h-8 flex-1 items-center rounded-md border border-input px-2 text-sm"
        >
          {value.name}
          {value.id === null ? <span className="ml-2 text-xs text-muted-foreground">(nova)</span> : null}
        </span>
        {readOnly ? null : (
          <Button type="button" variant="ghost" size="icon" aria-label={`Remover ${noun.lower}`} onClick={() => onChange(null)}>
            <X />
          </Button>
        )}
      </div>
    );
  }
  if (readOnly) return <span className="text-sm text-muted-foreground">Não informada</span>;

  const trimmed = term.trim();
  return (
    <div className="flex flex-col gap-2">
      <Input
        id={`lead-${kind}-search`}
        role="combobox"
        aria-expanded={open}
        aria-controls={`lead-${kind}-list`}
        aria-label={noun.label}
        placeholder={`Buscar ${noun.lower}`}
        value={term}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
      />
      {open ? (
        <ul id={`lead-${kind}-list`} role="listbox" className="max-h-40 overflow-y-auto rounded-md border text-sm">
          {results.length === 0 ? (
            <li className="px-2 py-1.5 text-muted-foreground">{noun.none}</li>
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
      {canCreate && trimmed ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            onChange({ id: null, name: trimmed });
            setOpen(false);
            setTerm("");
          }}
        >
          {noun.create}: {trimmed}
        </Button>
      ) : null}
    </div>
  );
}
