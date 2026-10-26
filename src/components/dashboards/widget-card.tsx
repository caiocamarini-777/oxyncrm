"use client";

import { useId, useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MAX_COLS,
  MAX_ROWS,
  MIN_COLS,
  MIN_ROWS,
  keyResize,
  snapSpan,
  type Spans,
} from "@/lib/dashboards/layout";

const GAP = 16;

export function WidgetCard({
  title,
  spans,
  readOnly,
  handle,
  onResize,
  onCommit,
  onRemove,
  children,
}: {
  title: string;
  spans: Spans;
  readOnly: boolean;
  /** Alça de mover (botão do dnd-kit), ausente no modo somente leitura. */
  handle?: React.ReactNode;
  onResize?: (s: Spans) => void;
  onCommit?: (s: Spans) => void;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  const cardRef = useRef<HTMLElement>(null);
  const descId = useId();
  const gesture = useRef<{
    x: number;
    y: number;
    cell: { w: number; h: number };
    start: Spans;
    last: Spans;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const card = cardRef.current;
    if (!card || !onResize) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      // tamanho de uma célula da grade: o card cobre `span` células mais as folgas entre elas
      cell: {
        w: (card.offsetWidth + GAP) / spans.colSpan,
        h: (card.offsetHeight + GAP) / spans.rowSpan,
      },
      start: spans,
      last: spans,
    };
  }
  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    if (!g || !onResize) return;
    const next = {
      colSpan: snapSpan(
        g.start.colSpan,
        e.clientX - g.x,
        g.cell.w,
        MIN_COLS,
        MAX_COLS,
      ),
      rowSpan: snapSpan(
        g.start.rowSpan,
        e.clientY - g.y,
        g.cell.h,
        MIN_ROWS,
        MAX_ROWS,
      ),
    };
    if (next.colSpan !== g.last.colSpan || next.rowSpan !== g.last.rowSpan) {
      g.last = next;
      onResize(next);
    }
  }
  function endGesture(e: React.PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (
      g &&
      (g.last.colSpan !== g.start.colSpan || g.last.rowSpan !== g.start.rowSpan)
    )
      onCommit?.(g.last);
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const next = keyResize(spans, e.key);
    if (!next) return;
    e.preventDefault();
    if (next.colSpan === spans.colSpan && next.rowSpan === spans.rowSpan)
      return;
    onResize?.(next);
    onCommit?.(next);
  }

  return (
    <article
      ref={cardRef}
      aria-label={title}
      data-testid="widget"
      data-col-span={spans.colSpan}
      data-row-span={spans.rowSpan}
      className="relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-lg border bg-card text-card-foreground"
    >
      <header className="flex items-center gap-1 border-b px-2 py-1.5">
        {handle}
        <h3
          className="min-w-0 flex-1 truncate px-1 font-heading text-sm font-semibold"
          title={title}
        >
          {title}
        </h3>
        {!readOnly && onRemove ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Ações do widget ${title}`}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                Remover
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      {!readOnly && onResize ? (
        <>
          <span id={descId} className="sr-only">
            {`Largura ${spans.colSpan} de ${MAX_COLS}, altura ${spans.rowSpan} de ${MAX_ROWS}. Use as setas do teclado para ajustar.`}
          </span>
          <button
            type="button"
            aria-label={`Redimensionar widget ${title}`}
            aria-describedby={descId}
            data-testid="widget-resize"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onKeyDown={onKeyDown}
            className="absolute right-0 bottom-0 hidden size-6 cursor-nwse-resize touch-none items-end justify-end rounded-tl-md p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:flex"
          >
            <svg viewBox="0 0 10 10" className="size-3" aria-hidden>
              <path
                d="M9 1v8H1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        </>
      ) : null}
    </article>
  );
}
