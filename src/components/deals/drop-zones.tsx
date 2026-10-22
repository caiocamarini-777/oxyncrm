"use client";

import { useDroppable } from "@dnd-kit/core";
import { CircleCheck, CircleX, Trash2, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "cn";

export type DropZoneKind = "won" | "lost" | "trash";
export const ZONE_PREFIX = "zone:";

const ZONES: Record<DropZoneKind, { label: string; icon: LucideIcon; idle: string; over: string }> = {
  won: {
    label: "Ganho",
    icon: CircleCheck,
    idle: "border-emerald-600/30 bg-emerald-600/5 text-emerald-700 dark:text-emerald-400",
    over: "border-emerald-600 bg-emerald-600/15",
  },
  lost: {
    label: "Perdido",
    icon: CircleX,
    idle: "border-red-600/30 bg-red-600/5 text-red-700 dark:text-red-400",
    over: "border-red-600 bg-red-600/15",
  },
  trash: {
    label: "Excluir",
    icon: Trash2,
    idle: "border-border bg-muted/60 text-muted-foreground",
    over: "border-foreground/40 bg-muted text-foreground",
  },
};

export const ZONE_LABELS: Record<DropZoneKind, string> = { won: ZONES.won.label, lost: ZONES.lost.label, trash: ZONES.trash.label };

function Zone({ kind, reduced }: { kind: DropZoneKind; reduced: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${ZONE_PREFIX}${kind}`, data: { type: "zone", kind } });
  const z = ZONES[kind];
  const Icon = z.icon;
  return (
    <motion.div
      ref={setNodeRef}
      data-testid={`drop-${kind}`}
      aria-label={z.label}
      animate={reduced ? undefined : { scale: isOver ? 1.04 : 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={cn(
        "flex h-16 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed font-heading text-sm font-semibold transition-colors",
        z.idle,
        isOver && z.over,
      )}
    >
      <Icon className="size-5" />
      {z.label}
    </motion.div>
  );
}

/** Rodapé que aparece durante o arraste: Ganho, Perdido e (com permissão) Excluir. */
export function DropZones({ visible, canDelete, reduced }: { visible: boolean; canDelete: boolean; reduced: boolean }) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="zones"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 48 }}
          transition={{ duration: reduced ? 0.1 : 0.2, ease: "easeOut" }}
          className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 px-4 py-3 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.25)] backdrop-blur"
        >
          <div className="mx-auto flex max-w-4xl gap-3">
            <Zone kind="won" reduced={reduced} />
            <Zone kind="lost" reduced={reduced} />
            {canDelete ? <Zone kind="trash" reduced={reduced} /> : null}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
