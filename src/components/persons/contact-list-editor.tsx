"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONTACT_LABELS, type ContactLabel } from "@/lib/persons/schema";

export type ContactRow = { label: ContactLabel; value: string };

/** Lista editável de e-mails ou telefones, com rótulo por linha. */
export function ContactListEditor({
  kind,
  rows,
  errors,
  onChange,
}: {
  kind: "email" | "phone";
  rows: ContactRow[];
  /** Mensagens de erro por índice. */
  errors: Record<number, string | undefined>;
  onChange: (rows: ContactRow[]) => void;
}) {
  const noun = kind === "email" ? "E-mail" : "Telefone";
  const defaultLabel: ContactLabel = kind === "email" ? "Trabalho" : "Celular";
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <select
              aria-label={`Rótulo do ${noun.toLowerCase()} ${i + 1}`}
              value={r.label}
              onChange={(e) =>
                onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value as ContactLabel } : x)))
              }
              className="h-8 w-28 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
            >
              {CONTACT_LABELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <Input
              aria-label={`${noun} ${i + 1}`}
              type={kind === "email" ? "email" : "tel"}
              inputMode={kind === "email" ? "email" : "tel"}
              placeholder={kind === "email" ? "nome@empresa.com" : "(11) 99999-0000"}
              value={r.value}
              aria-invalid={Boolean(errors[i])}
              onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remover ${noun.toLowerCase()} ${i + 1}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </div>
          {errors[i] ? (
            <p className="text-sm text-destructive" role="alert">
              {errors[i]}
            </p>
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => onChange([...rows, { label: defaultLabel, value: "" }])}
      >
        <Plus /> Adicionar {noun.toLowerCase()}
      </Button>
    </div>
  );
}
