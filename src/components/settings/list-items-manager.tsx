"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createListItem,
  moveListItem,
  renameListItem,
  setListItemActive,
  type ListKind,
} from "@/lib/lists/actions";

export type ListItemRow = { id: string; name: string; active: boolean };

export function ListItemsManager({
  kind,
  companyId,
  items,
  addLabel,
  emptyText,
}: {
  kind: ListKind;
  companyId: string;
  items: ListItemRow[];
  addLabel: string;
  emptyText: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    startTransition(async () => {
      const result = await createListItem(kind, companyId, name);
      if (!result.ok) {
        setCreateError(result.fieldErrors?.name ?? result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  function saveRename(id: string) {
    setEditError(null);
    startTransition(async () => {
      const result = await renameListItem(kind, id, editName);
      if (!result.ok) {
        setEditError(result.fieldErrors?.name ?? result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

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
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border p-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="list-name">{addLabel}</Label>
          <Input
            id="list-name"
            value={name}
            aria-invalid={Boolean(createError)}
            onChange={(e) => setName(e.target.value)}
            className="w-64"
          />
        </div>
        <Button type="submit" disabled={pending}>
          Adicionar
        </Button>
        {createError ? (
          <p role="alert" className="basis-full text-sm text-destructive">
            {createError}
          </p>
        ) : null}
      </form>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((it, i) => (
            <li
              key={it.id}
              data-testid="list-item-row"
              data-active={it.active}
              className="flex flex-wrap items-center gap-3 px-3 py-2"
            >
              {editingId === it.id ? (
                <>
                  <Input
                    aria-label={`Novo nome de ${it.name}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-64"
                  />
                  <Button size="sm" disabled={pending} onClick={() => saveRename(it.id)}>
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
                  <span className={"min-w-0 flex-1 truncate " + (it.active ? "font-medium" : "text-muted-foreground")}>
                    {it.name}
                    {it.active ? null : <Badge variant="outline" className="ml-2">Inativo</Badge>}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending || i === 0}
                      aria-label={`Subir ${it.name}`}
                      onClick={() => run(() => moveListItem(kind, it.id, "up"))}
                    >
                      Subir
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending || i === items.length - 1}
                      aria-label={`Descer ${it.name}`}
                      onClick={() => run(() => moveListItem(kind, it.id, "down"))}
                    >
                      Descer
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingId(it.id);
                        setEditName(it.name);
                        setEditError(null);
                      }}
                    >
                      Renomear
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => run(() => setListItemActive(kind, it.id, !it.active))}
                    >
                      {it.active ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
