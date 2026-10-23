"use client";

import { Check, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { updateActivity } from "@/lib/activities/actions";
import type { ActivityRow } from "@/lib/activities/queries";
import type { RecordActivityData } from "@/lib/activities/record-context";
import { formatDue, toLocalInput } from "@/lib/activities/time";
import { ActivityChip, TypeIcon } from "./activity-chip";
import { activeChannels, activeTypes } from "./activity-tab";
import { ActivityForm, type FormResult, type FormValues } from "./activity-form";
import { CompleteDialog } from "./complete-dialog";
import { toEditInput } from "./helpers";

function EditDialog({
  activity,
  data,
  onClose,
  onSaved,
}: {
  activity: ActivityRow;
  data: RecordActivityData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const channels = activeChannels(data);
  if (!channels.some((c) => c.id === activity.channel.id)) channels.push({ id: activity.channel.id, name: activity.channel.name });
  const types = activeTypes(data);
  if (!types.some((t) => t.id === activity.type.id)) types.push(activity.type);

  async function submit(values: FormValues): Promise<FormResult> {
    const res = await updateActivity(activity.id, toEditInput(values));
    if (!res.ok) return res;
    toast.success("Atividade atualizada.");
    onSaved();
    onClose();
    return { ok: true };
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar atividade</DialogTitle>
        </DialogHeader>
        <ActivityForm
          idPrefix="edit"
          companyId={data.companyId}
          types={types}
          channels={channels}
          owners={data.owners}
          canReassign={data.canReassign}
          initial={{
            typeId: activity.type.id,
            channelId: activity.channel.id,
            subject: activity.subject,
            description: activity.description ?? "",
            dueAt: toLocalInput(activity.dueAt),
            durationMinutes: activity.durationMinutes,
            reminderMinutes: activity.reminderMinutes,
            ownerId: activity.ownerId,
            person: activity.person,
            organization: activity.organization,
          }}
          parties={[
            ...(data.links.personId ? [] : (["person"] as const)),
            ...(data.links.organizationId ? [] : (["organization"] as const)),
          ]}
          submitLabel="Salvar"
          onCancel={onClose}
          onSubmit={submit}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Seção "Planejado": atividades abertas por data, com o círculo de concluir. */
export function PlannedList({ data }: { data: RecordActivityData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [completing, setCompleting] = useState<ActivityRow | null>(null);
  const [editing, setEditing] = useState<ActivityRow | null>(null);
  const now = new Date(data.nowIso);
  const refresh = () => startTransition(() => router.refresh());

  return (
    <>
      {data.open.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma atividade planejada.</p> : null}
      <ul className="flex flex-col gap-2">
        {data.open.map((a) => (
          <li key={a.id} data-testid="planned-activity" className="flex items-center gap-3 rounded-md border bg-card p-3">
            {data.canEdit ? (
              <button
                type="button"
                aria-label={`Concluir ${a.subject}`}
                title="Concluir"
                onClick={() => setCompleting(a)}
                className="group flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-input text-transparent transition-colors hover:border-primary hover:text-primary focus-visible:border-primary focus-visible:text-primary focus-visible:outline-none"
              >
                <Check aria-hidden className="size-4" />
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <TypeIcon name={a.type.name} isMeeting={a.type.isMeeting} className="text-muted-foreground" />
                <span className="truncate">{a.subject}</span>
                <ActivityChip status={a.status} />
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDue(a.dueAt, now)} · {a.channel.name} · {a.ownerName}
              </p>
            </div>
            {data.canEdit ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Editar ${a.subject}`} onClick={() => setEditing(a)}>
                <Pencil aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <CompleteDialog activity={completing} data={data} onClose={() => setCompleting(null)} onChanged={refresh} />
      {editing ? <EditDialog key={editing.id} activity={editing} data={data} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </>
  );
}
