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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createPipeline,
  createStage,
  deleteStage,
  reorderStages,
  setPipelineArchived,
  updatePipeline,
  updateStage,
} from "@/lib/pipelines/actions";
import type { PipelineRow, StageRow } from "@/lib/pipelines/queries";
import {
  CARD_VALUE_FIELDS,
  CARD_VALUE_LABELS,
  NEXT_ACTIVITY_LABELS,
  NEXT_ACTIVITY_RULES,
} from "@/lib/pipelines/schema";
import { REQUIRED_FIELD_OPTIONS, requiredFieldLabel } from "@/lib/deals/required";

type CustomDef = { key: string; label: string };

const SELECT_CLASS = "h-9 rounded-md border border-input bg-background px-3 text-sm";

export function PipelinesManager({
  companyId,
  pipelines,
  customDefs,
}: {
  companyId: string;
  pipelines: PipelineRow[];
  customDefs: CustomDef[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function create(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    startTransition(async () => {
      const result = await createPipeline(companyId, { name, nextActivityRule: "off", cardValueField: "total" });
      if (!result.ok) {
        setCreateError(result.fieldErrors?.name ?? result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  function toggleArchive(p: PipelineRow) {
    setError(null);
    startTransition(async () => {
      const result = await setPipelineArchived(p.id, !p.archived);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-md border p-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pipeline-new-name">Novo funil</Label>
          <Input
            id="pipeline-new-name"
            value={name}
            aria-invalid={Boolean(createError)}
            onChange={(e) => setName(e.target.value)}
            className="w-64"
          />
        </div>
        <Button type="submit" disabled={pending}>
          Criar funil
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

      {pipelines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum funil cadastrado.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pipelines.map((p) => (
            <PipelineItem
              key={p.id}
              pipeline={p}
              customDefs={customDefs}
              pending={pending}
              onToggleArchive={() => toggleArchive(p)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function PipelineItem({
  pipeline,
  customDefs,
  pending,
  onToggleArchive,
}: {
  pipeline: PipelineRow;
  customDefs: CustomDef[];
  pending: boolean;
  onToggleArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li
      data-testid="pipeline-row"
      data-archived={pipeline.archived}
      className="rounded-md border"
    >
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <span className={"min-w-0 flex-1 truncate " + (pipeline.archived ? "text-muted-foreground" : "font-medium")}>
          {pipeline.name}
          {pipeline.archived ? <Badge variant="outline" className="ml-2">Arquivado</Badge> : null}
        </span>
        <span className="text-sm text-muted-foreground">
          {pipeline.stages.length} {pipeline.stages.length === 1 ? "etapa" : "etapas"}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-label={`${open ? "Fechar" : "Editar"} ${pipeline.name}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Fechar" : "Editar"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          aria-label={`${pipeline.archived ? "Restaurar" : "Arquivar"} ${pipeline.name}`}
          onClick={onToggleArchive}
        >
          {pipeline.archived ? "Restaurar" : "Arquivar"}
        </Button>
      </div>
      {open ? <PipelineEditor pipeline={pipeline} customDefs={customDefs} /> : null}
    </li>
  );
}

function PipelineEditor({ pipeline, customDefs }: { pipeline: PipelineRow; customDefs: CustomDef[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(pipeline.name);
  const [rule, setRule] = useState<string>(pipeline.nextActivityRule);
  const [card, setCard] = useState<string>(pipeline.cardValueField);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newStage, setNewStage] = useState("");
  const [newStageError, setNewStageError] = useState<string | null>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updatePipeline(pipeline.id, {
        name,
        nextActivityRule: rule as PipelineRow["nextActivityRule"],
        cardValueField: card as PipelineRow["cardValueField"],
      });
      if (!result.ok) {
        setNameError(result.fieldErrors?.name ?? result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function addStage(e: React.FormEvent) {
    e.preventDefault();
    setNewStageError(null);
    startTransition(async () => {
      const result = await createStage(pipeline.id, {
        name: newStage,
        probability: 0,
        rottingDays: "",
        requiredFields: [],
      });
      if (!result.ok) {
        setNewStageError(result.fieldErrors?.name ?? result.error);
        return;
      }
      setNewStage("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5 border-t px-3 py-4">
      <form onSubmit={save} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pn-${pipeline.id}`}>Nome do funil</Label>
          <Input
            id={`pn-${pipeline.id}`}
            value={name}
            aria-invalid={Boolean(nameError)}
            onChange={(e) => setName(e.target.value)}
            className="w-64"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pr-${pipeline.id}`}>Próxima atividade</Label>
          <select id={`pr-${pipeline.id}`} value={rule} onChange={(e) => setRule(e.target.value)} className={SELECT_CLASS}>
            {NEXT_ACTIVITY_RULES.map((r) => (
              <option key={r} value={r}>
                {NEXT_ACTIVITY_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pc-${pipeline.id}`}>Valor no card</Label>
          <select id={`pc-${pipeline.id}`} value={card} onChange={(e) => setCard(e.target.value)} className={SELECT_CLASS}>
            {CARD_VALUE_FIELDS.map((f) => (
              <option key={f} value={f}>
                {CARD_VALUE_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          Salvar funil
        </Button>
        {saved ? <span role="status" className="text-sm text-muted-foreground">Funil salvo.</span> : null}
        {nameError ? (
          <p role="alert" className="basis-full text-sm text-destructive">
            {nameError}
          </p>
        ) : null}
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-semibold">Etapas</h3>
        <StageList
          key={pipeline.stages.map((s) => s.id).join(",")}
          pipelineId={pipeline.id}
          stages={pipeline.stages}
          customDefs={customDefs}
        />
        <form onSubmit={addStage} className="flex flex-wrap items-end gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`ns-${pipeline.id}`}>Nova etapa</Label>
            <Input
              id={`ns-${pipeline.id}`}
              value={newStage}
              aria-invalid={Boolean(newStageError)}
              onChange={(e) => setNewStage(e.target.value)}
              className="w-64"
            />
          </div>
          <Button type="submit" variant="outline" disabled={pending}>
            Adicionar etapa
          </Button>
          {newStageError ? (
            <p role="alert" className="basis-full text-sm text-destructive">
              {newStageError}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}

function StageList({
  pipelineId,
  stages,
  customDefs,
}: {
  pipelineId: string;
  stages: StageRow[];
  customDefs: CustomDef[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [order, setOrder] = useState(stages.map((s) => s.id));
  const [error, setError] = useState<string | null>(null);
  const byId = new Map(stages.map((s) => [s.id, s]));
  const name = (id: string | number) => byId.get(String(id))?.name ?? "";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    const previous = order;
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const result = await reorderStages(pipelineId, next);
      if (!result.ok) {
        setOrder(previous);
        setError(result.error);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Etapa ${name(active.id)} levantada.`,
            onDragOver: ({ active, over }) =>
              over ? `Etapa ${name(active.id)} na posição ${order.indexOf(String(over.id)) + 1} de ${order.length}.` : "Fora da lista.",
            onDragEnd: ({ active, over }) =>
              over ? `Etapa ${name(active.id)} solta na posição ${order.indexOf(String(over.id)) + 1}.` : "Movimento cancelado.",
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
              const stage = byId.get(id);
              return stage ? <StageRowEditor key={`${id}:${JSON.stringify(stage)}`} stage={stage} customDefs={customDefs} /> : null;
            })}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function StageRowEditor({ stage, customDefs }: { stage: StageRow; customDefs: CustomDef[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  const [name, setName] = useState(stage.name);
  const [probability, setProbability] = useState(String(stage.probability));
  const [rotting, setRotting] = useState(stage.rottingDays === null ? "" : String(stage.rottingDays));
  const [required, setRequired] = useState<string[]>(stage.requiredFields);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const options = [
    ...REQUIRED_FIELD_OPTIONS.map((o) => ({ key: o.key as string, label: o.label as string })),
    ...customDefs.map((d) => ({ key: `cf:${d.key}`, label: d.label })),
  ];
  // Campos obrigatórios que não existem mais (ex.: campo arquivado) continuam visíveis para serem removidos.
  for (const k of stage.requiredFields) {
    if (!options.some((o) => o.key === k)) options.push({ key: k, label: requiredFieldLabel(k, customDefs) });
  }

  function toggle(key: string) {
    setRequired((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  function save() {
    setErrors({});
    setMessage(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateStage(stage.id, {
        name,
        probability: probability.trim() === "" ? Number.NaN : Number(probability),
        rottingDays: rotting,
        requiredFields: required,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setMessage(result.fieldErrors ? null : result.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function remove() {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await deleteStage(stage.id);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li
      ref={setNodeRef}
      data-testid="stage-row"
      data-stage-name={stage.name}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={"flex flex-wrap items-start gap-3 rounded-md border bg-background p-3 " + (isDragging ? "z-10 shadow-md" : "")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Arrastar etapa ${stage.name}`}
        className="mt-6 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sn-${stage.id}`}>Nome da etapa</Label>
        <Input id={`sn-${stage.id}`} value={name} aria-invalid={Boolean(errors.name)} onChange={(e) => setName(e.target.value)} className="w-48" />
        {errors.name ? <p role="alert" className="text-sm text-destructive">{errors.name}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sp-${stage.id}`}>Probabilidade (%)</Label>
        <Input id={`sp-${stage.id}`} inputMode="numeric" value={probability} aria-invalid={Boolean(errors.probability)} onChange={(e) => setProbability(e.target.value)} className="w-28" />
        {errors.probability ? <p role="alert" className="text-sm text-destructive">{errors.probability}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`sr-${stage.id}`}>Dias para esfriar</Label>
        <Input id={`sr-${stage.id}`} inputMode="numeric" value={rotting} aria-invalid={Boolean(errors.rottingDays)} onChange={(e) => setRotting(e.target.value)} className="w-28" />
        {errors.rottingDays ? <p role="alert" className="text-sm text-destructive">{errors.rottingDays}</p> : null}
      </div>
      <details className="min-w-56 rounded-md border px-3 py-1.5 text-sm">
        <summary className="cursor-pointer select-none">
          Campos obrigatórios ({required.length})
        </summary>
        <div role="group" aria-label={`Campos obrigatórios de ${stage.name}`} className="mt-2 flex flex-col gap-1.5 pb-1">
          {options.map((o) => (
            <label key={o.key} className="flex items-center gap-2">
              <input type="checkbox" checked={required.includes(o.key)} onChange={() => toggle(o.key)} />
              {o.label}
            </label>
          ))}
        </div>
        {errors.requiredFields ? <p role="alert" className="text-sm text-destructive">{errors.requiredFields}</p> : null}
      </details>
      <div className="mt-6 flex gap-2">
        <Button size="sm" disabled={pending} aria-label={`Salvar etapa ${stage.name}`} onClick={save}>
          Salvar
        </Button>
        <Button size="sm" variant="outline" disabled={pending} aria-label={`Excluir etapa ${stage.name}`} onClick={remove}>
          Excluir
        </Button>
      </div>
      {message ? <p role="alert" className="basis-full text-sm text-destructive">{message}</p> : null}
      {saved ? <p role="status" className="basis-full text-sm text-muted-foreground">Etapa salva.</p> : null}
    </li>
  );
}
