"use client";

import { Input } from "@/components/ui/input";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import { formatDate, formatMoney } from "@/lib/records/format";
import type { AssignableOwner } from "@/lib/records/types";

/*
 * Passe apenas definições ATIVAS (arquivadas ficam fora): o valor de um campo arquivado
 * continua no jsonb do registro, só não é exibido nem editado.
 */

const selectClass = "h-8 w-full rounded-md border border-input bg-background px-2 text-sm";

export function CustomFieldInput({
  def,
  value,
  onChange,
  owners = [],
}: {
  def: CustomFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  owners?: AssignableOwner[];
}) {
  const id = `cf-${def.key}`;
  switch (def.type) {
    case "text":
      return (
        <Input
          id={id}
          value={typeof value === "string" ? value : ""}
          maxLength={2000}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
      );
    case "number":
    case "money":
      return (
        <Input
          id={id}
          type="number"
          step={def.type === "money" ? "0.01" : "any"}
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            onChange(e.target.value === "" || Number.isNaN(n) ? null : n);
          }}
        />
      );
    case "date":
      return (
        <Input
          id={id}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
      );
    case "select":
      return (
        <select
          id={id}
          className={selectClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">Selecione</option>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const current = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-col gap-1" id={id}>
          {def.options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={current.includes(o)}
                onChange={(e) => {
                  const next = e.target.checked ? [...current, o] : current.filter((c) => c !== o);
                  onChange(next.length === 0 ? null : next);
                }}
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "user":
      return (
        <select
          id={id}
          className={selectClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        >
          <option value="">Selecione</option>
          {owners
            .filter((o) => o.active || o.id === value)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.fullName}
                {o.active ? "" : " (inativo)"}
              </option>
            ))}
        </select>
      );
  }
}

export function formatCustomFieldValue(
  def: CustomFieldDef,
  value: unknown,
  owners: AssignableOwner[] = [],
): string {
  if (value === null || value === undefined || value === "") return "";
  switch (def.type) {
    case "text":
    case "select":
      return String(value);
    case "number":
      return typeof value === "number" ? new Intl.NumberFormat("pt-BR").format(value) : "";
    case "money":
      return typeof value === "number" ? formatMoney(value) : "";
    case "date":
      return typeof value === "string" ? formatDate(value) : "";
    case "multiselect":
      return Array.isArray(value) ? value.join(", ") : "";
    case "user": {
      const o = owners.find((x) => x.id === value);
      return o ? `${o.fullName}${o.active ? "" : " (inativo)"}` : "";
    }
  }
}

export function CustomFieldValue({
  def,
  value,
  owners = [],
}: {
  def: CustomFieldDef;
  value: unknown;
  owners?: AssignableOwner[];
}) {
  const text = formatCustomFieldValue(def, value, owners);
  return text === "" ? <span className="text-muted-foreground">Não informado</span> : <span>{text}</span>;
}
