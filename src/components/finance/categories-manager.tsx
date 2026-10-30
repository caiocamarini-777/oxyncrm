"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createExpenseCategory,
  createIncomeCategory,
  setExpenseCategoryActive,
  setIncomeCategoryActive,
  updateExpenseCategory,
  updateIncomeCategory,
} from "@/lib/finance/settings-actions";

type Nature = "fixed" | "variable" | "non_recurring";
export type CategoryRow = { id: string; name: string; active: boolean; defaultNature?: Nature };

const NATURES: { id: Nature; name: string }[] = [
  { id: "fixed", name: "Fixa" },
  { id: "variable", name: "Variável" },
  { id: "non_recurring", name: "Não recorrente" },
];
const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

function Row({ kind, category, canManage }: { kind: "expense" | "income"; category: CategoryRow; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(category.name);
  const [nature, setNature] = useState<Nature>(category.defaultNature ?? "fixed");
  const [error, setError] = useState<string | null>(null);

  function save(next: { name: string; nature: Nature }) {
    if (next.name === category.name && next.nature === (category.defaultNature ?? "fixed")) return;
    setError(null);
    startTransition(async () => {
      const r =
        kind === "expense"
          ? await updateExpenseCategory(category.id, { name: next.name, defaultNature: next.nature })
          : await updateIncomeCategory(category.id, { name: next.name });
      if (!r.ok) {
        setError(r.fieldErrors?.name ?? r.error);
        return;
      }
      router.refresh();
    });
  }
  function toggle(active: boolean) {
    setError(null);
    startTransition(async () => {
      const r = kind === "expense" ? await setExpenseCategoryActive(category.id, active) : await setIncomeCategoryActive(category.id, active);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <li data-testid="fin-category-row" className="flex flex-wrap items-center gap-3 rounded-md border bg-background p-3">
      <Input
        aria-label={`Nome de ${category.name}`}
        value={name}
        disabled={pending || !canManage}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => save({ name, nature })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save({ name, nature });
          }
        }}
        className={"w-64 " + (category.active ? "" : "text-muted-foreground")}
      />
      {kind === "expense" ? (
        <select
          aria-label={`Natureza padrão de ${category.name}`}
          className={selectClass}
          value={nature}
          disabled={pending || !canManage}
          onChange={(e) => {
            setNature(e.target.value as Nature);
            save({ name, nature: e.target.value as Nature });
          }}
        >
          {NATURES.map((n) => (
            <option key={n.id} value={n.id}>{n.name}</option>
          ))}
        </select>
      ) : null}
      {canManage ? (
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor={`fin-cat-${category.id}`} className="text-sm text-muted-foreground">{category.active ? "Ativa" : "Inativa"}</Label>
          <Switch
            id={`fin-cat-${category.id}`}
            aria-label={`${category.active ? "Desativar" : "Ativar"} ${category.name}`}
            checked={category.active}
            disabled={pending}
            onCheckedChange={toggle}
          />
        </div>
      ) : null}
      {error ? <p role="alert" className="basis-full text-sm text-destructive">{error}</p> : null}
    </li>
  );
}

/** Categorias de despesa (com natureza padrão) ou de receita: criação em uma linha, renomear e ativar/desativar. */
export function CategoriesManager({
  kind,
  companyId,
  categories,
  canManage,
}: {
  kind: "expense" | "income";
  companyId: string;
  categories: CategoryRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [nature, setNature] = useState<Nature>("fixed");
  const [createError, setCreateError] = useState<string | null>(null);
  const id = `${kind}-category-name`;

  function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    startTransition(async () => {
      const r =
        kind === "expense"
          ? await createExpenseCategory(companyId, { name, defaultNature: nature })
          : await createIncomeCategory(companyId, { name });
      if (!r.ok) {
        setCreateError(r.fieldErrors?.name ?? r.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border p-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{kind === "expense" ? "Nova categoria de despesa" : "Nova categoria de receita"}</Label>
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} className="w-64" />
          </div>
          {kind === "expense" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="expense-category-nature">Natureza padrão</Label>
              <select id="expense-category-nature" className={selectClass} value={nature} onChange={(e) => setNature(e.target.value as Nature)}>
                {NATURES.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </div>
          ) : null}
          <Button type="submit">Adicionar categoria</Button>
          {createError ? <p role="alert" className="basis-full text-sm text-destructive">{createError}</p> : null}
        </form>
      ) : null}
      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {categories.map((c) => (
            <Row key={`${c.id}:${c.name}:${c.defaultNature}:${c.active}`} kind={kind} category={c} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}
