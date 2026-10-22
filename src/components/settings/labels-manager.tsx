"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLabel, deleteLabel, updateLabel } from "@/lib/labels/actions";
import { LABEL_COLOR_CLASSES, LABEL_SWATCH_CLASSES } from "@/lib/labels/colors";
import { LABEL_COLORS, LABEL_COLOR_NAMES, type LabelColor } from "@/lib/custom-fields/schema";
import { cn } from "cn";

export type LabelRow = { id: string; name: string; color: LabelColor };

function ColorPicker({
  value,
  onChange,
  name,
}: {
  value: LabelColor;
  onChange: (c: LabelColor) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={`Cor ${name}`} className="flex gap-1.5">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={LABEL_COLOR_NAMES[c]}
          title={LABEL_COLOR_NAMES[c]}
          onClick={() => onChange(c)}
          className={cn(
            "size-6 rounded-full border-2 border-transparent",
            LABEL_SWATCH_CLASSES[c],
            value === c && "ring-2 ring-foreground/60 ring-offset-2 ring-offset-background",
          )}
        />
      ))}
    </div>
  );
}

export function LabelsManager({ companyId, labels }: { companyId: string; labels: LabelRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("teal");
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<LabelColor>("teal");
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LabelRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    startTransition(async () => {
      const result = await createLabel(companyId, { name, color });
      if (!result.ok) {
        setCreateError(result.fieldErrors?.name ?? result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  function startEdit(l: LabelRow) {
    setEditingId(l.id);
    setEditName(l.name);
    setEditColor(l.color);
    setEditError(null);
  }

  function saveEdit(id: string) {
    setEditError(null);
    startTransition(async () => {
      const result = await updateLabel(id, { name: editName, color: editColor });
      if (!result.ok) {
        setEditError(result.fieldErrors?.name ?? result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const result = await deleteLabel(target.id);
      if (result.ok) {
        setDeleting(null);
        router.refresh();
      } else {
        setDeleteError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border p-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="label-name">Nome da etiqueta</Label>
          <Input
            id="label-name"
            value={name}
            aria-invalid={Boolean(createError)}
            onChange={(e) => setName(e.target.value)}
            className="w-56"
          />
        </div>
        <ColorPicker value={color} onChange={setColor} name="da nova etiqueta" />
        <Button type="submit" disabled={pending}>
          Criar etiqueta
        </Button>
        {createError ? (
          <p role="alert" className="basis-full text-sm text-destructive">
            {createError}
          </p>
        ) : null}
      </form>

      {labels.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma etiqueta cadastrada.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {labels.map((l) => (
            <li key={l.id} data-testid="label-row" className="flex flex-wrap items-center gap-3 px-3 py-2">
              {editingId === l.id ? (
                <>
                  <Input
                    aria-label={`Nome da etiqueta ${l.name}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-56"
                  />
                  <ColorPicker value={editColor} onChange={setEditColor} name={l.name} />
                  <Button size="sm" disabled={pending} onClick={() => saveEdit(l.id)}>
                    Salvar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                    Cancelar
                  </Button>
                  {editError ? (
                    <p role="alert" className="basis-full text-sm text-destructive">
                      {editError}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium",
                      LABEL_COLOR_CLASSES[l.color],
                    )}
                  >
                    {l.name}
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => startEdit(l)}>
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDeleteError(null);
                        setDeleting(l);
                      }}
                    >
                      Excluir
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              A etiqueta será removida de todos os registros que a usam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button disabled={pending} onClick={confirmDelete}>
              Confirmar exclusão
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
