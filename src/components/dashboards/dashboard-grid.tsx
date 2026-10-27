"use client";

import { useEffect, useRef, useState } from "react";
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
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import type { Spans } from "@/lib/dashboards/layout";
import { SaveQueue } from "@/lib/dashboards/save-queue";
import { removeWidget, updateWidgetLayout } from "@/lib/reports/actions";
import { WidgetCard } from "./widget-card";

export type GridItem = {
  id: string;
  title: string;
  colSpan: number;
  rowSpan: number;
  /** Selo ao lado do título (período). */
  badge?: string | null;
  /** Conteúdo renderizado no servidor (um Suspense por widget). */
  content: React.ReactNode;
};

type Slot = { id: string } & Spans;

// Classes completas para o Tailwind enxergar; abaixo de 768px a grade tem uma coluna e os spans não valem.
const COL: Record<number, string> = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4" };
const ROW: Record<number, string> = { 1: "md:row-span-1", 2: "md:row-span-2", 3: "md:row-span-3" };

const signature = (items: GridItem[]) => items.map((i) => `${i.id}:${i.colSpan}x${i.rowSpan}`).join("|");
const toSlots = (items: GridItem[]): Slot[] => items.map((i) => ({ id: i.id, colSpan: i.colSpan, rowSpan: i.rowSpan }));

function SortableWidget({
  item,
  spans,
  readOnly,
  onResize,
  onCommit,
  onRemove,
}: {
  item: GridItem;
  spans: Spans;
  readOnly: boolean;
  onResize: (s: Spans) => void;
  onCommit: (s: Spans) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: readOnly,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${COL[spans.colSpan]} ${ROW[spans.rowSpan]} ${isDragging ? "relative z-10 opacity-80 shadow-lg" : ""}`}
    >
      <WidgetCard
        title={item.title}
        badge={item.badge}
        spans={spans}
        readOnly={readOnly}
        handle={
          readOnly ? undefined : (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Mover widget ${item.title}`}
              className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            >
              <GripVertical className="size-4" aria-hidden />
            </button>
          )
        }
        onResize={readOnly ? undefined : onResize}
        onCommit={readOnly ? undefined : onCommit}
        onRemove={readOnly ? undefined : onRemove}
      >
        {item.content}
      </WidgetCard>
    </div>
  );
}

/** Grade de 4 colunas (1 abaixo de 768px) com ordenação por arraste e redimensionamento por alça. */
export function DashboardGrid({
  dashboardId,
  items,
  readOnly,
}: {
  dashboardId: string;
  items: GridItem[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const sig = signature(items);
  const [seen, setSeen] = useState(sig);
  const [layout, setLayout] = useState<Slot[]>(() => toSlots(items));
  // Salvamentos em andamento: enquanto houver, a resposta do servidor é parcial e não substitui o layout local.
  const [saving, setSaving] = useState(0);
  const [queue] = useState(() => new SaveQueue());
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  });
  // O servidor é a fonte da verdade: quando ele devolve outro layout (widget novo ou removido), recomeçamos dele.
  if (seen !== sig && saving === 0) {
    setSeen(sig);
    setLayout(toSlots(items));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const title = (id: string | number) => byId.get(String(id))?.title ?? "";
  const visible = layout.filter((s) => byId.has(s.id));

  // Salvamentos em fila: cada um espera o anterior (chegam ao banco na ordem) e uma falha descarta os que
  // esperavam atrás dela, para não reenviar layouts mais velhos que o revertido.
  function persist(next: Slot[]) {
    setSaving((n) => n + 1);
    queue.enqueue(
      async () => {
        const res = await updateWidgetLayout(
          dashboardId,
          next.map((s, i) => ({ id: s.id, position: i, colSpan: s.colSpan, rowSpan: s.rowSpan })),
        );
        if (!res.ok) toast.error(res.error);
        return res.ok;
      },
      (outcome) => {
        if (outcome === "failed") setLayout(toSlots(latest.current)); // volta ao que o servidor tem
        setSaving((n) => n - 1);
      },
    );
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = layout.findIndex((s) => s.id === active.id);
    const to = layout.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(layout, from, to);
    setLayout(next);
    persist(next);
  }

  const withSpans = (id: string, s: Spans) => layout.map((w) => (w.id === id ? { ...w, ...s } : w));
  const resize = (id: string, s: Spans) => setLayout(withSpans(id, s));
  function commit(id: string, s: Spans) {
    const next = withSpans(id, s);
    setLayout(next);
    persist(next);
  }

  async function remove(id: string) {
    const res = await removeWidget(id);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Widget removido.");
    router.refresh();
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Widget ${title(active.id)} levantado.`,
          onDragOver: ({ active, over }) =>
            over
              ? `Widget ${title(active.id)} na posição ${visible.findIndex((s) => s.id === over.id) + 1} de ${visible.length}.`
              : "Fora da grade.",
          onDragEnd: ({ active, over }) =>
            over
              ? `Widget ${title(active.id)} solto na posição ${visible.findIndex((s) => s.id === over.id) + 1}.`
              : "Movimento cancelado.",
          onDragCancel: () => "Movimento cancelado.",
        },
      }}
    >
      <SortableContext items={visible.map((s) => s.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 gap-4 md:auto-rows-[280px] md:grid-cols-4" data-testid="dashboard-grid">
          {visible.map((s) => (
            <SortableWidget
              key={s.id}
              item={byId.get(s.id)!}
              spans={s}
              readOnly={readOnly}
              onResize={(sp) => resize(s.id, sp)}
              onCommit={(sp) => commit(s.id, sp)}
              onRemove={() => void remove(s.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
