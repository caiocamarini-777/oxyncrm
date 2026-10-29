"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBrowserClient } from "@/lib/supabase/client";
import { createServiceCategory } from "@/lib/service-categories/actions";

type Option = { id: string; name: string; active: boolean };

const NEW = "__new__";
const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

/**
 * Seletor de categoria de serviço da empresa. Mostra só as ativas (mais a atual, se já estiver
 * inativa) e, com `allowCreate` (admin geral), oferece "Nova categoria…".
 */
export function ServiceCategorySelect({
  companyId,
  value,
  onChange,
  allowCreate = false,
  id,
  disabled = false,
  ariaLabel,
}: {
  companyId: string;
  value: string | null;
  onChange: (value: string | null) => void;
  allowCreate?: boolean;
  id?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    createBrowserClient()
      .from("service_categories")
      .select("id, name, active")
      .eq("company_id", companyId)
      .order("position")
      .order("name")
      .then(({ data }) => {
        if (!cancelled && data) setOptions(data as Option[]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const visible = options.filter((o) => o.active || o.id === value);

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createServiceCategory(companyId, { name });
      if (!res.ok) {
        setError(res.fieldErrors?.name ?? res.error);
        return;
      }
      setOptions((cur) => [...cur, { id: res.data.id, name: name.trim(), active: true }]);
      setName("");
      setCreating(false);
      onChange(res.data.id);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        id={id}
        aria-label={ariaLabel}
        value={creating ? NEW : (value ?? "")}
        disabled={disabled}
        className={SELECT_CLASS}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setCreating(true);
            return;
          }
          setCreating(false);
          onChange(e.target.value || null);
        }}
      >
        <option value="">Sem categoria</option>
        {visible.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.active ? "" : " (inativa)"}
          </option>
        ))}
        {allowCreate ? <option value={NEW}>Nova categoria…</option> : null}
      </select>
      {creating ? (
        <div className="flex gap-2">
          <Input
            aria-label="Nome da nova categoria"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              }
            }}
          />
          <Button type="button" size="sm" disabled={pending} onClick={create}>
            Criar
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
