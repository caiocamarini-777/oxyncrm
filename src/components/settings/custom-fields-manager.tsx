"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomField,
  moveCustomField,
  setCustomFieldArchived,
  updateCustomField,
} from "@/lib/custom-fields/actions";
import {
  CUSTOM_FIELD_ENTITIES_PHASE2,
  CUSTOM_FIELD_ENTITY_LABELS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
  slugifyKey,
  type CustomFieldEntity,
  type CustomFieldType,
} from "@/lib/custom-fields/schema";
import { useCloseAfterSave } from "@/lib/use-close-after-save";

export type CustomFieldRow = {
  id: string;
  entity: CustomFieldEntity;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  archived: boolean;
};

export function CustomFieldsManager({
  companyId,
  fields,
}: {
  companyId: string;
  fields: CustomFieldRow[];
}) {
  const router = useRouter();
  const [entity, setEntity] = useState<CustomFieldEntity>("organizations");
  const [editing, setEditing] = useState<CustomFieldRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = fields.filter((f) => f.entity === entity);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Não foi possível concluir. Tente novamente.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Entidade" className="flex gap-1 border-b">
        {CUSTOM_FIELD_ENTITIES_PHASE2.map((e) => (
          <button
            key={e}
            role="tab"
            type="button"
            aria-selected={entity === e}
            onClick={() => setEntity(e)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors " +
              (entity === e
                ? "border-brand font-medium text-brand"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {CUSTOM_FIELD_ENTITY_LABELS[e]}
          </button>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>Novo campo</Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum campo personalizado nesta aba.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((f, i) => (
            <li
              key={f.id}
              data-testid="custom-field-row"
              data-archived={f.archived}
              className="flex flex-wrap items-center gap-3 px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={"truncate font-medium " + (f.archived ? "text-muted-foreground" : "")}>
                  {f.label}
                  {f.archived ? <Badge variant="outline" className="ml-2">Arquivado</Badge> : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {CUSTOM_FIELD_TYPE_LABELS[f.type]}
                  {f.options.length > 0 ? `: ${f.options.join(", ")}` : ""}
                </span>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || i === 0}
                  aria-label={`Subir ${f.label}`}
                  onClick={() => run(() => moveCustomField(f.id, "up"))}
                >
                  Subir
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || i === rows.length - 1}
                  aria-label={`Descer ${f.label}`}
                  onClick={() => run(() => moveCustomField(f.id, "down"))}
                >
                  Descer
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(f)}>
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => setCustomFieldArchived(f.id, !f.archived))}
                >
                  {f.archived ? "Restaurar" : "Arquivar"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing ? (
            <FieldForm
              key={editing === "new" ? "new" : editing.id}
              companyId={companyId}
              entity={entity}
              field={editing === "new" ? null : editing}
              close={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldForm({
  companyId,
  entity,
  field,
  close,
}: {
  companyId: string;
  entity: CustomFieldEntity;
  field: CustomFieldRow | null;
  close: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const markSaved = useCloseAfterSave(pending, close);
  const [label, setLabel] = useState(field?.label ?? "");
  const [type, setType] = useState<CustomFieldType>(field?.type ?? "text");
  const [optionsText, setOptionsText] = useState(field?.options.join("\n") ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const hasOptions = type === "select" || type === "multiselect";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    const options = optionsText
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean);
    startTransition(async () => {
      const result = field
        ? await updateCustomField(field.id, { label, options })
        : await createCustomField(companyId, entity, { label, type, options });
      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        else setFormError(result.error);
        return;
      }
      router.refresh();
      markSaved();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{field ? "Editar campo" : "Novo campo"}</DialogTitle>
        <DialogDescription>
          {field
            ? "O tipo e a chave do campo não mudam depois de criados."
            : "O campo aparece nos formulários e nos detalhes da entidade."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cf-label">Nome do campo</Label>
        <Input
          id="cf-label"
          value={label}
          aria-invalid={Boolean(errors.label)}
          onChange={(e) => setLabel(e.target.value)}
        />
        {errors.label ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.label}
          </p>
        ) : !field && label.trim() ? (
          <p className="text-xs text-muted-foreground">Chave: {slugifyKey(label)}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cf-type">Tipo</Label>
        <select
          id="cf-type"
          value={type}
          disabled={Boolean(field)}
          onChange={(e) => setType(e.target.value as CustomFieldType)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
        >
          {CUSTOM_FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {CUSTOM_FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>
      {hasOptions ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cf-options">Opções (uma por linha)</Label>
          <Textarea
            id="cf-options"
            rows={5}
            value={optionsText}
            aria-invalid={Boolean(errors.options)}
            onChange={(e) => setOptionsText(e.target.value)}
          />
          {errors.options ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.options}
            </p>
          ) : null}
        </div>
      ) : null}
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
