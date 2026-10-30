"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createServiceCategory,
  reorderServiceCategories,
  setServiceCategoryActive,
  updateServiceCategory,
} from "@/lib/service-categories/actions";

export type ServiceCategoryRow = {
  id: string;
  name: string;
  color: string;
  active: boolean;
};

export function ServiceCategoriesManager({
  companyId,
  categories,
}: {
  companyId: string;
  categories: ServiceCategoryRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState(categories.map((c) => c.id));
  const [prevIds, setPrevIds] = useState(categories.map((c) => c.id).join());
  const ids = categories.map((c) => c.id).join();
  if (ids !== prevIds) {
    // O servidor devolveu outra lista (criação, recarga): recomeça a ordem local.
    setPrevIds(ids);
    setOrder(categories.map((c) => c.id));
  }
  const byId = new Map(categories.map((c) => [c.id, c]));
  const label = (id: string | number) => byId.get(String(id))?.name ?? "";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    startTransition(async () => {
      const result = await createServiceCategory(companyId, { name });
      if (!result.ok) {
        setCreateError(result.fieldErrors?.name ?? result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    const previous = order;
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const result = await reorderServiceCategories(companyId, next);
      if (!result.ok) {
        setOrder(previous);
        setError(result.error);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border p-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category-name">Nova categoria</Label>
          <Input
            id="category-name"
            value={name}
            aria-invalid={Boolean(createError)}
            onChange={(e) => setName(e.target.value)}
            className="w-72"
          />
        </div>
        <Button type="submit">Adicionar categoria</Button>
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

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => `Categoria ${label(active.id)} levantada.`,
              onDragOver: ({ active, over }) =>
                over
                  ? `Categoria ${label(active.id)} na posição ${order.indexOf(String(over.id)) + 1} de ${order.length}.`
                  : "Fora da lista.",
              onDragEnd: ({ active, over }) =>
                over ? `Categoria ${label(active.id)} solta na posição ${order.indexOf(String(over.id)) + 1}.` : "Movimento cancelado.",
              onDragCancel: () => "Movimento cancelado.",
            },
            screenReaderInstructions: {
              draggable: "Para reordenar, pressione Espaço, use as setas para cima e para baixo e pressione Espaço de novo. Esc cancela.",
            },
          }}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-2">
              {order.map((id) => {
                const c = byId.get(id);
                return c ? <CategoryRow key={`${id}:${c.name}:${c.color}:${c.active}`} category={c} /> : null;
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function CategoryRow({ category }: { category: ServiceCategoryRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  });
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [error, setError] = useState<string | null>(null);

  function save(next: { name: string; color: string }) {
    if (next.name === category.name && next.color === category.color) return;
    setError(null);
    startTransition(async () => {
      const result = await updateServiceCategory(category.id, next);
      if (!result.ok) {
        setError(result.fieldErrors?.name ?? result.error);
        return;
      }
      router.refresh();
    });
  }

  function toggle(active: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setServiceCategoryActive(category.id, active);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <li
      ref={setNodeRef}
      data-testid="category-row"
      data-category-name={category.name}
      data-active={category.active}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={"flex flex-wrap items-center gap-3 rounded-md border bg-background p-3 " + (isDragging ? "z-10 shadow-md" : "")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Arrastar categoria ${category.name}`}
        className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <input
        type="color"
        aria-label={`Cor de ${category.name}`}
        value={color}
        disabled={pending}
        onChange={(e) => setColor(e.target.value)}
        onBlur={() => save({ name, color })}
        className="size-8 cursor-pointer rounded border border-input bg-background p-0.5"
      />
      <Input
        aria-label={`Nome de ${category.name}`}
        value={name}
        aria-invalid={Boolean(error)}
        disabled={pending}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => save({ name, color })}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save({ name, color });
          }
        }}
        className={"w-64 " + (category.active ? "" : "text-muted-foreground")}
      />
      <div className="ml-auto flex items-center gap-2">
        <Label htmlFor={`active-${category.id}`} className="text-sm text-muted-foreground">
          {category.active ? "Ativa" : "Inativa"}
        </Label>
        <Switch
          id={`active-${category.id}`}
          aria-label={`${category.active ? "Desativar" : "Ativar"} ${category.name}`}
          checked={category.active}
          disabled={pending}
          onCheckedChange={toggle}
        />
      </div>
      {error ? (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}
