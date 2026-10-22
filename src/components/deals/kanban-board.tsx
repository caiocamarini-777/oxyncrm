"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import type { CustomFieldDef } from "@/lib/custom-fields/schema";
import {
  getDealEditSnapshot,
  markLost,
  markWon,
  moveDeal,
  type DealEditSnapshot,
  type DealResult,
} from "@/lib/deals/actions";
import { positionBetween } from "@/lib/deals/kanban";
import type { Board, BoardDeal } from "@/lib/deals/queries";
import { moveToTrash } from "@/lib/records/actions";
import type { AssignableOwner } from "@/lib/records/types";
import { DealCardBody } from "./deal-card";
import { DropZones, ZONE_LABELS, ZONE_PREFIX, type DropZoneKind } from "./drop-zones";
import { COLUMN_PREFIX, KanbanColumn } from "./kanban-column";
import { LostDialog, type LostReasonOption } from "./lost-dialog";
import { RequiredFieldsDialog } from "./required-fields-dialog";

type Columns = Record<string, BoardDeal[]>;
type Origin = { stageId: string; index: number };
/**
 * Mudança local ainda não refletida pelo servidor. `inFlight`: a ação está rodando (o card fica
 * travado). Depois do sucesso a entrada fica "assentada" até o quadro do servidor confirmar (ou
 * por algumas adoções), para um refresh antigo não fazer o card piscar de volta.
 */
type Pending = {
  deal: BoardDeal;
  origin: Origin;
  inFlight: boolean;
  /** Destino otimista; `null` quando o card saiu do quadro (ganho, perdido, lixeira). */
  target: { stageId: string; position: number } | null;
  /** Adoções restantes antes de descartar uma entrada assentada não confirmada. */
  ttl: number;
};
type RequiredState = { snapshot: DealEditSnapshot; stageId: string; stageName: string; missing: string[]; position: number };

const REFRESH_MS = 30_000;
/** Tempo do tremor (300 ms) com folga; depois o token é limpo para não repetir ao remontar. */
const SHAKE_MS = 400;
/** Espaço levanta e solta (Enter fica para o link do título abrir o detalhe). */
const KEYBOARD_CODES = { start: ["Space"], cancel: ["Escape"], end: ["Space"] };
const DROP_SPRING = { duration: 240, easing: "cubic-bezier(0.18, 0.89, 0.32, 1.18)" };

const fromBoard = (b: Board): Columns => Object.fromEntries(b.stages.map((s) => [s.id, s.deals]));

function locate(cols: Columns, id: string): { stageId: string; index: number } | null {
  for (const [stageId, list] of Object.entries(cols)) {
    const index = list.findIndex((d) => d.id === id);
    if (index >= 0) return { stageId, index };
  }
  return null;
}

function findDeal(cols: Columns, id: string): BoardDeal | null {
  const at = locate(cols, id);
  return at ? cols[at.stageId][at.index] : null;
}

function without(cols: Columns, id: string): Columns {
  const at = locate(cols, id);
  if (!at) return cols;
  return { ...cols, [at.stageId]: cols[at.stageId].filter((d) => d.id !== id) };
}

/** Move o card para `stageId`, na posição `index` da lista sem ele. */
function placeAt(cols: Columns, id: string, stageId: string, index: number): Columns {
  const deal = findDeal(cols, id);
  if (!deal) return cols;
  const rest = without(cols, id);
  const list = [...(rest[stageId] ?? [])];
  list.splice(Math.max(0, Math.min(index, list.length)), 0, { ...deal, stageId });
  return { ...rest, [stageId]: list };
}

/** Devolve um card à etapa/índice de origem dentro das colunas atuais (sem mexer nos outros). */
function restore(cols: Columns, deal: BoardDeal, origin: Origin): Columns {
  const rest = without(cols, deal.id);
  if (!rest[origin.stageId]) return rest;
  const list = [...rest[origin.stageId]];
  list.splice(Math.max(0, Math.min(origin.index, list.length)), 0, { ...deal, stageId: origin.stageId });
  return { ...rest, [origin.stageId]: list };
}

/** O quadro do servidor já mostra o resultado da mudança? */
function confirmed(cols: Columns, p: Pending): boolean {
  if (!p.target) return locate(cols, p.deal.id) === null;
  const d = findDeal(cols, p.deal.id);
  return d !== null && d.stageId === p.target.stageId && d.position === p.target.position;
}

/** Quadro do servidor com as mudanças locais ainda pendentes reaplicadas por cima. */
function overlay(cols: Columns, pending: Iterable<Pending>): Columns {
  let out = cols;
  for (const p of pending) {
    if (!p.target) out = without(out, p.deal.id);
    else if (out[p.target.stageId]) {
      const base = findDeal(out, p.deal.id) ?? p.deal;
      out = placeByPosition(without(out, p.deal.id), p.deal.id, p.target.stageId, p.target.position, base);
    }
  }
  return out;
}

/** Insere respeitando a ordem por `position` (após salvar no diálogo de obrigatórios). */
function placeByPosition(cols: Columns, id: string, stageId: string, position: number, fallback?: BoardDeal): Columns {
  const deal = findDeal(cols, id) ?? fallback;
  if (!deal) return cols;
  const rest = without(cols, id);
  const list = [...(rest[stageId] ?? []), { ...deal, stageId, position }].sort((a, b) => a.position - b.position);
  return { ...rest, [stageId]: list };
}

const isZone = (id: unknown) => String(id).startsWith(ZONE_PREFIX);
const isColumn = (id: unknown) => String(id).startsWith(COLUMN_PREFIX);

/**
 * Zonas do rodapé primeiro; depois a coluna sob o ponteiro e, dentro dela, o card mais próximo.
 * Sem ponteiro (teclado), usa a interseção do card levantado.
 */
const collision: CollisionDetection = (args) => {
  const hits = args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args);
  const zone = hits.find((c) => isZone(c.id));
  if (zone) return [zone];
  const col = hits.find((c) => isColumn(c.id));
  if (!col) return hits.filter((c) => !isZone(c.id)).slice(0, 1);
  const stageId = String(col.id).slice(COLUMN_PREFIX.length);
  const cards = args.droppableContainers.filter(
    (c) => c.data.current?.type === "card" && c.data.current.stageId === stageId && c.id !== args.active.id,
  );
  if (cards.length === 0) return [col];
  const near = closestCenter({ ...args, droppableContainers: cards });
  return near.length > 0 ? [near[0]] : [col];
};

export function KanbanBoard({
  board,
  companyId,
  companySlug,
  stageLimit,
  canEdit,
  canDelete,
  defs,
  owners,
  lostReasons,
}: {
  board: Board;
  companyId: string;
  companySlug: string;
  stageLimit: number;
  canEdit: boolean;
  canDelete: boolean;
  defs: CustomFieldDef[];
  owners: AssignableOwner[];
  lostReasons: LostReasonOption[];
}) {
  const router = useRouter();
  const dndId = useId();
  const reduced = useReducedMotion() ?? false;
  const [columns, setColumns] = useState<Columns>(() => fromBoard(board));
  const [seenBoard, setSeenBoard] = useState(board);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overZone, setOverZone] = useState(false);
  const [shake, setShake] = useState<{ id: string; token: number } | null>(null);
  const [required, setRequired] = useState<RequiredState | null>(null);
  const [lost, setLost] = useState<BoardDeal | null>(null);
  const [pending, setPending] = useState<ReadonlyMap<string, Pending>>(() => new Map());
  const origin = useRef<Origin | null>(null);
  const idle = useRef(true);

  // O servidor manda, mas fora de arraste: o quadro recebido é adotado com as mudanças locais ainda
  // pendentes reaplicadas por cima (sem piscar nem duplicar cards). Durante um arraste, espera.
  if (board !== seenBoard && activeId === null) {
    const server = fromBoard(board);
    const next = new Map<string, Pending>();
    for (const [id, p] of pending) {
      if (p.inFlight) next.set(id, p);
      else if (!confirmed(server, p) && p.ttl > 1) next.set(id, { ...p, ttl: p.ttl - 1 });
    }
    setSeenBoard(board);
    setPending(next);
    setColumns(overlay(server, next.values()));
  }
  /** Só os cards com movimento em andamento ficam travados. */
  const locked = (id: string) => pending.get(id)?.inFlight === true;
  const anyInFlight = [...pending.values()].some((p) => p.inFlight);

  useEffect(() => {
    idle.current = activeId === null && !anyInFlight && required === null && lost === null;
  }, [activeId, anyInFlight, required, lost]);

  // Atualiza a cada 30 s com a aba visível (e ao voltar para a aba), sem atrapalhar um arraste.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && idle.current) router.refresh();
    };
    const timer = setInterval(tick, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: KEYBOARD_CODES }),
  );

  const stageName = (id: string) => board.stages.find((s) => s.id === id)?.name ?? "";
  const dealHref = (id: string) => `/${companySlug}/negocios/${id}`;
  const activeDeal = activeId ? findDeal(columns, activeId) : null;

  function bump(id: string) {
    const token = Date.now();
    setShake({ id, token });
    setTimeout(() => setShake((s) => (s?.token === token ? null : s)), SHAKE_MS);
  }

  /** Devolve o foco ao card (link do título) quando um diálogo aberto a partir dele fecha. */
  function focusCard(id: string) {
    return (e: Event) => {
      e.preventDefault();
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-deal-id="${id}"] [data-testid="deal-title"]`)?.focus();
      });
    };
  }

  function setEntry(id: string, update: (p: Pending | undefined) => Pending | null) {
    setPending((prev) => {
      const next = new Map(prev);
      const value = update(prev.get(id));
      if (value) next.set(id, value);
      else next.delete(id);
      return next;
    });
  }

  /**
   * Roda a ação de um card sem travar o quadro: o card fica travado até a resposta; se falhar,
   * só ele volta para a origem (nas colunas atuais) com tremor.
   */
  async function track<R extends { ok: boolean; error?: string }>(
    deal: BoardDeal,
    from: Origin,
    target: Pending["target"],
    action: () => Promise<R>,
  ): Promise<R | { ok: false; error: string }> {
    setEntry(deal.id, () => ({ deal, origin: from, target, inFlight: true, ttl: 2 }));
    let res: R | { ok: false; error: string };
    try {
      res = await action();
    } catch {
      res = { ok: false, error: "Não foi possível concluir. Tente novamente." };
    }
    if (res.ok) {
      setEntry(deal.id, (p) => (p ? { ...p, inFlight: false } : null));
    } else {
      setEntry(deal.id, () => null);
      setColumns((c) => restore(c, deal, from));
      bump(deal.id);
    }
    router.refresh();
    return res;
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const at = locate(columns, id);
    if (!at) return;
    origin.current = at;
    setActiveId(id);
  }

  function onDragOver({ active, over }: DragOverEvent) {
    setOverZone(Boolean(over && isZone(over.id)));
    if (!over || isZone(over.id)) return;
    const id = String(active.id);
    const overId = String(over.id);
    if (overId === id) return;
    setColumns((prev) => {
      const from = locate(prev, id);
      if (!from) return prev;
      if (isColumn(overId)) {
        const stageId = overId.slice(COLUMN_PREFIX.length);
        if (stageId === from.stageId || !prev[stageId]) return prev;
        return placeAt(prev, id, stageId, prev[stageId].length);
      }
      const to = locate(prev, overId);
      if (!to) return prev;
      const list = prev[to.stageId].filter((d) => d.id !== id);
      const j = list.findIndex((d) => d.id === overId);
      const rect = active.rect.current.translated;
      const after = rect ? rect.top + rect.height / 2 > over.rect.top + over.rect.height / 2 : false;
      const index = after ? j + 1 : j;
      if (to.stageId === from.stageId && index === from.index) return prev;
      return placeAt(prev, id, to.stageId, index);
    });
  }

  /** Devolve só o card arrastado para onde estava (os outros cards podem ter mudado no meio). */
  function putBack(id: string, o: Origin) {
    setColumns((c) => {
      const deal = findDeal(c, id);
      return deal ? restore(c, deal, o) : c;
    });
  }

  function onDragCancel({ active }: { active: { id: string | number } }) {
    if (origin.current) putBack(String(active.id), origin.current);
    origin.current = null;
    setActiveId(null);
    setOverZone(false);
  }

  /** Ação otimista: o card some na hora; se falhar, volta com tremor e aviso. */
  function runRemoval(deal: BoardDeal, from: Origin, action: () => Promise<DealResult | { ok: boolean; error?: string }>, done: string) {
    setColumns((c) => without(c, deal.id));
    void track(deal, from, null, action).then((res) => {
      if (res.ok) toast.success(done);
      else toast.error("error" in res && res.error ? res.error : "Não foi possível concluir. Tente novamente.");
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const o = origin.current;
    origin.current = null;
    setActiveId(null);
    setOverZone(false);
    if (!o) return;
    const deal = findDeal(columns, id);
    if (!over || !deal) {
      putBack(id, o);
      return;
    }
    if (isZone(over.id)) {
      const kind = String(over.id).slice(ZONE_PREFIX.length) as DropZoneKind;
      const original = { ...deal, stageId: o.stageId };
      if (kind === "won") runRemoval(original, o, () => markWon(id), "Negócio marcado como ganho.");
      else if (kind === "trash") runRemoval(original, o, () => moveToTrash("deals", id), "Negócio movido para a lixeira.");
      else {
        putBack(id, o);
        setLost(original);
      }
      return;
    }

    const now = locate(columns, id);
    if (!now) {
      putBack(id, o);
      return;
    }
    if (now.stageId === o.stageId && now.index === o.index) return;
    const list = columns[now.stageId];
    // Vizinhos visíveis: com filtros ativos ou coluna truncada (500 cards), negócios ocultos podem
    // ficar entre eles e a ordem relativa a esses ocultos fica aproximada. Só a ordem é afetada;
    // o próximo refresh mostra a ordem real do servidor.
    const position = positionBetween(list[now.index - 1]?.position ?? null, list[now.index + 1]?.position ?? null);
    const target = now.stageId;
    setColumns((c) => ({ ...c, [target]: c[target].map((d) => (d.id === id ? { ...d, position } : d)) }));

    const original = { ...deal, stageId: o.stageId };
    void track(original, o, { stageId: target, position }, () => moveDeal(id, target, position)).then(async (r) => {
      if (r.ok) return;
      if ("missing" in r && r.missing && r.missing.length > 0) {
        const snap = await getDealEditSnapshot(id);
        if (snap.ok) {
          setRequired({ snapshot: snap.data, stageId: target, stageName: stageName(target), missing: r.missing, position });
        } else {
          toast.error(snap.error);
        }
      } else {
        toast.error(r.error);
      }
    });
  }

  /** Assenta uma mudança feita por diálogo (já gravada) para o próximo refresh não desfazê-la. */
  function settle(deal: BoardDeal, target: Pending["target"]) {
    const at = locate(columns, deal.id);
    setEntry(deal.id, () => ({ deal, origin: at ?? { stageId: deal.stageId, index: 0 }, target, inFlight: false, ttl: 2 }));
  }

  async function retryRequired(r: RequiredState): Promise<DealResult> {
    const res = await moveDeal(r.snapshot.id, r.stageId, r.position);
    if (res.ok) {
      const deal = findDeal(columns, r.snapshot.id);
      if (deal) settle(deal, { stageId: r.stageId, position: r.position });
      setColumns((c) => placeByPosition(c, r.snapshot.id, r.stageId, r.position));
      router.refresh();
    }
    return res;
  }

  async function confirmLost(deal: BoardDeal, input: { reasonId: string; note?: string | null }): Promise<DealResult> {
    const res = await markLost(deal.id, input);
    if (res.ok) {
      settle(deal, null);
      setColumns((c) => without(c, deal.id));
      toast.success("Negócio marcado como perdido.");
      router.refresh();
    }
    return res;
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Card ${findDeal(columns, String(active.id))?.title ?? ""} levantado.`,
    onDragOver: ({ over }) => {
      if (!over) return "Fora de uma etapa.";
      if (isZone(over.id)) return `Sobre a zona ${ZONE_LABELS[String(over.id).slice(ZONE_PREFIX.length) as DropZoneKind]}.`;
      const stageId = isColumn(over.id) ? String(over.id).slice(COLUMN_PREFIX.length) : over.data.current?.stageId;
      return `Sobre a etapa ${stageName(String(stageId))}.`;
    },
    onDragEnd: ({ over }) => (over ? "Card solto." : "Movimento cancelado."),
    onDragCancel: () => "Movimento cancelado.",
  };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Para mover o card, pressione Espaço, use as setas para escolher a etapa e pressione Espaço de novo. Esc cancela. Enter abre o negócio.",
        },
      }}
    >
      <div className="-mx-1 flex min-h-[60vh] gap-3 overflow-x-auto px-1 pb-24" data-testid="kanban-board">
        {board.stages.map((s) => {
          const local = columns[s.id] ?? [];
          return (
            <KanbanColumn
              key={s.id}
              stage={s}
              deals={local}
              hiddenCount={Math.max(0, s.count - s.deals.length)}
              truncated={s.truncated}
              stageLimit={stageLimit}
              field={board.pipeline.cardValueField}
              dealHref={dealHref}
              canDrag={(id) => canEdit && !locked(id)}
              reduced={reduced}
              shake={shake}
            />
          );
        })}
      </div>

      <DragOverlay dropAnimation={reduced || overZone ? null : DROP_SPRING}>
        {activeDeal ? (
          <motion.div
            initial={{ scale: 1, rotate: 0 }}
            animate={reduced ? { scale: 1, rotate: 0 } : { scale: 1.02, rotate: 2 }}
            transition={{ type: "spring", stiffness: 500, damping: 28 }}
            className="cursor-grabbing"
          >
            <DealCardBody deal={activeDeal} field={board.pipeline.cardValueField} href={dealHref(activeDeal.id)} lifted />
          </motion.div>
        ) : null}
      </DragOverlay>

      <DropZones visible={activeId !== null} canDelete={canDelete} reduced={reduced} />

      {lost ? (
        <LostDialog
          open
          onOpenChange={(o) => (o ? null : setLost(null))}
          dealTitle={lost.title}
          reasons={lostReasons}
          onConfirm={(input) => confirmLost(lost, input)}
          onCloseAutoFocus={focusCard(lost.id)}
        />
      ) : null}
      {required ? (
        <RequiredFieldsDialog
          key={`${required.snapshot.id}-${required.stageId}`}
          deal={required.snapshot}
          stageName={required.stageName}
          missing={required.missing}
          companyId={companyId}
          dealHref={dealHref(required.snapshot.id)}
          defs={defs}
          owners={owners}
          onRetry={() => retryRequired(required)}
          onClose={() => setRequired(null)}
          onCloseAutoFocus={focusCard(required.snapshot.id)}
        />
      ) : null}
    </DndContext>
  );
}
