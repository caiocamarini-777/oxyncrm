"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { completeActivity, createActivity } from "@/lib/activities/actions";
import type { ActivityRow } from "@/lib/activities/queries";
import type { RecordActivityData } from "@/lib/activities/record-context";
import { MEETING_OUTCOMES, MEETING_OUTCOME_LABELS, type MeetingOutcome } from "@/lib/activities/schema";
import { cn } from "cn";
import { activeChannels, activeTypes } from "./activity-tab";
import { ActivityForm, type FormResult, type FormValues } from "./activity-form";
import { defaultDue, linksOf, toCreateInput, toNextInput } from "./helpers";

const GROUPS = [
  { key: "success", label: "Sucesso" },
  { key: "neutral", label: "Neutro" },
  { key: "failure", label: "Insucesso" },
] as const;

type Stage = "form" | "next-required" | "suggest";

function Choice({
  checked,
  label,
  onSelect,
}: {
  checked: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex min-h-8 items-center gap-2 rounded-md border px-2.5 py-1 text-left text-sm transition-colors",
        checked ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-accent",
      )}
    >
      <span
        aria-hidden
        className={cn("size-3.5 shrink-0 rounded-full border", checked ? "border-primary bg-primary" : "border-input")}
      />
      {label}
    </button>
  );
}

function CompleteBody({
  activity,
  data,
  onClose,
  onChanged,
  onBusy,
}: {
  activity: ActivityRow;
  data: RecordActivityData;
  onClose: () => void;
  onChanged: () => void;
  /** Marca "salvando" para o dialog ignorar fechamento (Esc, clique fora). */
  onBusy: (busy: boolean) => void;
}) {
  const reduce = useReducedMotion();
  const isMeeting = activity.type.isMeeting;
  const outcomes = data.catalog.outcomes.filter((o) => o.active && o.appliesTo === "activity");
  const qualifications = data.catalog.outcomes.filter((o) => o.active && o.appliesTo === "meeting");
  const party = activity.person?.name ?? activity.organization?.name ?? data.partyName;

  const [stage, setStage] = useState<Stage>("form");
  const [outcomeId, setOutcomeId] = useState("");
  const [meetingOutcome, setMeetingOutcome] = useState<MeetingOutcome | "">("");
  const [qualificationId, setQualificationId] = useState("");
  const [note, setNote] = useState("");
  const [meetingSubject, setMeetingSubject] = useState(party ? `Reunião com ${party}` : "Reunião");
  const [meetingDue, setMeetingDue] = useState("");
  const [meetingDuration, setMeetingDuration] = useState("30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const chosen = outcomes.find((o) => o.id === outcomeId);
  const rescheduling = isMeeting && meetingOutcome === "rescheduled";
  const booking = rescheduling || (!isMeeting && Boolean(chosen?.booksMeeting));
  const meetingReady = meetingSubject.trim() !== "" && meetingDue !== "" && Number.isInteger(Number(meetingDuration));
  const ready = (isMeeting ? meetingOutcome !== "" : outcomeId !== "") && (!booking || meetingReady);

  async function complete(next?: FormValues): Promise<FormResult> {
    if (inFlight.current) return { ok: false, error: "" };
    inFlight.current = true;
    onBusy(true);
    setSaving(true);
    setError(null);
    try {
      const res = await completeActivity(activity.id, {
        isMeeting,
        outcomeId: isMeeting ? (meetingOutcome === "held" && qualificationId ? qualificationId : null) : outcomeId,
        meetingOutcome: isMeeting ? (meetingOutcome || null) : null,
        note,
        meeting: booking
          ? { subject: meetingSubject.trim(), dueAt: meetingDue, durationMinutes: Number(meetingDuration) }
          : null,
        next: next ? toNextInput(next) : null,
      });
      if (!res.ok) {
        if (res.code === "next_required") {
          setStage("next-required");
          // o aviso já está no quadro "Agende a próxima atividade"; sem texto repetido no formulário
          return { ok: false, error: "" };
        }
        if (!next) setError(res.error);
        return { ok: false, error: res.error, fieldErrors: res.fieldErrors };
      }
      toast.success("Atividade concluída.");
      onChanged();
      if (res.data.rule === "suggest" && !res.data.nextId) {
        setStage("suggest");
        return { ok: true };
      }
      onClose();
      return { ok: true };
    } finally {
      inFlight.current = false;
      onBusy(false);
      setSaving(false);
    }
  }

  async function createSuggested(values: FormValues): Promise<FormResult> {
    onBusy(true);
    const res = await createActivity(data.companyId, toCreateInput(values, linksOf(activity))).finally(() => {
      onBusy(false);
    });
    if (!res.ok) return res;
    toast.success("Atividade criada.");
    onChanged();
    onClose();
    return { ok: true };
  }

  const types = activeTypes(data);
  const channels = activeChannels(data);
  const nextInitial = {
    typeId: types.some((t) => t.id === activity.type.id) ? activity.type.id : undefined,
    channelId: channels.some((c) => c.id === activity.channel.id) ? activity.channel.id : undefined,
    dueAt: defaultDue(data.nowIso, 1),
    ownerId: activity.ownerId,
  };

  if (stage === "suggest") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Próxima atividade</DialogTitle>
          <DialogDescription>Atividade concluída. Que tal já deixar a próxima agendada?</DialogDescription>
        </DialogHeader>
        <ActivityForm
          idPrefix="suggest"
          companyId={data.companyId}
          types={types}
          channels={channels}
          owners={data.owners}
          canReassign={data.canReassign}
          initial={nextInitial}
          parties={[]}
          withDescription={false}
          autoFocusFirst
          submitLabel="Agendar"
          cancelLabel="Agora não"
          onCancel={onClose}
          onSubmit={createSuggested}
        />
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Concluir atividade</DialogTitle>
        <DialogDescription>{activity.subject}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        {isMeeting ? (
          <div className="flex flex-col gap-1.5">
            <span id="complete-meeting-label" className="text-sm font-medium">
              Como foi a reunião?
            </span>
            <div role="radiogroup" aria-labelledby="complete-meeting-label" className="grid grid-cols-2 gap-2">
              {MEETING_OUTCOMES.map((m) => (
                <Choice
                  key={m}
                  label={MEETING_OUTCOME_LABELS[m]}
                  checked={meetingOutcome === m}
                  onSelect={() => setMeetingOutcome(m)}
                />
              ))}
            </div>
            {meetingOutcome === "held" && qualifications.length > 0 ? (
              <div className="mt-1 flex flex-col gap-1.5">
                <span id="complete-qualification-label" className="text-sm font-medium">
                  Resultado da reunião
                </span>
                <div role="radiogroup" aria-labelledby="complete-qualification-label" className="grid gap-1.5 sm:grid-cols-3">
                  {qualifications.map((o) => (
                    <Choice
                      key={o.id}
                      label={o.name}
                      checked={qualificationId === o.id}
                      onSelect={() => setQualificationId(qualificationId === o.id ? "" : o.id)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span id="complete-outcome-label" className="text-sm font-medium">
              Resultado
            </span>
            <div role="radiogroup" aria-labelledby="complete-outcome-label" className="flex flex-col gap-2">
              {GROUPS.map((g) => {
                const items = outcomes.filter((o) => o.classification === g.key);
                if (items.length === 0) return null;
                return (
                  <div key={g.key} className="flex flex-col gap-1">
                    <span className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.label}
                    </span>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {items.map((o) => (
                        <Choice key={o.id} label={o.name} checked={outcomeId === o.id} onSelect={() => setOutcomeId(o.id)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {booking ? (
            <motion.div
              key="meeting"
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <fieldset className="flex flex-col gap-2 rounded-md border p-3" data-testid="schedule-meeting">
                <legend className="px-1 text-sm font-medium">{rescheduling ? "Nova data da reunião" : "Agendar reunião"}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="meeting-due">Data e hora da reunião</Label>
                    <Input id="meeting-due" type="datetime-local" value={meetingDue} onChange={(e) => setMeetingDue(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="meeting-duration">Duração (minutos)</Label>
                    <Input
                      id="meeting-duration"
                      type="number"
                      min={0}
                      max={1440}
                      step={5}
                      value={meetingDuration}
                      onChange={(e) => setMeetingDuration(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="meeting-subject">Assunto da reunião</Label>
                  <Input id="meeting-subject" value={meetingSubject} maxLength={200} onChange={(e) => setMeetingSubject(e.target.value)} />
                </div>
              </fieldset>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="complete-note">Nota</Label>
          <Textarea id="complete-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {stage === "next-required" ? (
          <div className="flex flex-col gap-2 rounded-md border border-primary/40 p-3" data-testid="next-required">
            <p className="text-sm font-medium">Agende a próxima atividade para concluir.</p>
            <ActivityForm
              idPrefix="next"
              companyId={data.companyId}
              types={types}
              channels={channels}
              owners={data.owners}
              canReassign={data.canReassign}
              initial={nextInitial}
              parties={[]}
              withDescription={false}
              submitLabel="Concluir e agendar"
              cancelLabel="Cancelar"
              onCancel={onClose}
              onSubmit={(v) =>
                ready ? complete(v) : Promise.resolve({ ok: false, error: "Preencha o resultado e a reunião antes de concluir." })
              }
            />
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {stage === "form" ? (
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={!ready || saving} onClick={() => void complete()}>
            Concluir
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
}

/** Concluir atividade: resultado (ou desfecho da reunião), nota, reunião a agendar e próxima atividade. */
export function CompleteDialog({
  activity,
  data,
  onClose,
  onChanged,
}: {
  activity: ActivityRow | null;
  data: RecordActivityData;
  onClose: () => void;
  onChanged: () => void;
}) {
  const busy = useRef(false);
  return (
    <Dialog open={activity !== null} onOpenChange={(o) => !o && !busy.current && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {activity ? (
          <CompleteBody key={activity.id} activity={activity} data={data} onClose={onClose} onChanged={onChanged} onBusy={(b) => { busy.current = b; }} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
