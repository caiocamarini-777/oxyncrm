"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import { Check, ChevronDown, CircleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/activities/time";
import type { ActionResult } from "@/lib/db-errors";
import { confirmSuggestion, dismissSuggestion, getMeetingTranscript } from "@/lib/meet/actions";
import { validateEdited } from "@/lib/meet/decisions";
import type { TranscriptSource } from "@/lib/meet/notes";
import type { RecordMeeting, RecordMeetingNotes, RecordMeetingSuggestion } from "@/lib/meet/queries";
import {
  describeNextStep,
  describeSuggestion,
  FORM_FIELDS,
  formValuesFor,
  meetingAnchor,
  payloadFromForm,
  SUGGESTION_LABELS,
  type FormValues,
} from "@/lib/meet/view";
import { cn } from "cn";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm">
      {items.map((item, i) => (
        <li key={i} className="break-words">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Resumo, dores, objeções, qualificação (pergunta e resposta) e próximos passos. */
function NotesView({ notes }: { notes: RecordMeetingNotes }) {
  return (
    <div className="flex flex-col gap-3">
      {notes.summary.trim() ? <p className="whitespace-pre-wrap break-words text-sm">{notes.summary.trim()}</p> : null}
      {notes.pains.length > 0 ? (
        <Section title="Dores">
          <Bullets items={notes.pains} />
        </Section>
      ) : null}
      {notes.objections.length > 0 ? (
        <Section title="Objeções">
          <Bullets items={notes.objections} />
        </Section>
      ) : null}
      {notes.qualification.length > 0 ? (
        <Section title="Qualificação">
          <dl className="flex flex-col gap-1.5 text-sm">
            {notes.qualification.map((q, i) => (
              <div key={i}>
                <dt className="font-medium">{q.question}</dt>
                <dd className="break-words text-muted-foreground">{q.answer}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}
      {notes.next_steps.length > 0 ? (
        <Section title="Próximos passos">
          <Bullets items={notes.next_steps.map(describeNextStep)} />
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Uma sugestão do assistente. Pendente: Confirmar, Editar (formulário ali mesmo) e Descartar. Com falha: o erro
 * e Confirmar de novo, Editar (ex.: tipo ou etapa que não existe mais) ou Descartar. Confirmada ou descartada: só
 * a situação. Sem permissão de edição, só leitura. O destino (Pipedrive ou CRM) segue `MEETING_SINK`, no servidor,
 * e o erro guardado já diz de onde veio.
 */
function SuggestionRow({ suggestion, canEdit }: { suggestion: RecordMeetingSuggestion; canEdit: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const idBase = useId();
  const { id, kind, status } = suggestion;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FormValues>(() => formValuesFor(kind, suggestion.payload));
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decidable = canEdit && (status === "pending" || status === "failed");

  async function run(fn: () => Promise<ActionResult>, okMessage: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (res.ok) {
        toast.success(okMessage);
        setEditing(false);
      } else {
        toast.error(res.error);
      }
      // Também no erro: o servidor pode ter mudado a sugestão (falha ao gravar vira "failed").
      startTransition(() => router.refresh());
    } catch {
      toast.error("Não foi possível concluir agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  function saveEdited() {
    const valid = validateEdited(kind, payloadFromForm(kind, values));
    if (!valid.ok) {
      setFormError(valid.error);
      return;
    }
    setFormError(null);
    void run(() => confirmSuggestion(id, valid.payload), "Sugestão confirmada e gravada.");
  }

  function cancelEdit() {
    setEditing(false);
    setFormError(null);
    setValues(formValuesFor(kind, suggestion.payload));
  }

  return (
    <div className="rounded-md border bg-muted/30 p-2.5 text-sm" data-testid="meeting-suggestion" data-status={status}>
      <p className="text-xs font-medium text-muted-foreground">{SUGGESTION_LABELS[kind]}</p>
      <p className={cn("break-words", status === "dismissed" && "text-muted-foreground line-through")}>
        {describeSuggestion(kind, suggestion.payload)}
      </p>

      {status === "confirmed" ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="size-3.5" aria-hidden /> Confirmada e gravada.
        </p>
      ) : null}
      {status === "dismissed" ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <X className="size-3.5" aria-hidden /> Descartada.
        </p>
      ) : null}
      {status === "pending" && !canEdit ? <p className="mt-1 text-xs text-muted-foreground">Aguardando a decisão do vendedor.</p> : null}
      {status === "failed" ? (
        <p role="alert" className="mt-1 flex items-start gap-1 text-xs text-destructive">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span className="break-words">
            Não foi possível gravar{suggestion.lastError ? `: ${suggestion.lastError}` : "."}
          </span>
        </p>
      ) : null}

      {decidable && editing ? (
        <form
          noValidate
          className="mt-2 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveEdited();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {FORM_FIELDS[kind].map((f) => (
              <div key={f.name} className={cn("flex flex-col gap-1", f.name === "subject" && "sm:col-span-2")}>
                <Label htmlFor={`${idBase}-${f.name}`} className="text-xs">
                  {f.label}
                </Label>
                <Input
                  id={`${idBase}-${f.name}`}
                  type={f.type}
                  required={f.required}
                  maxLength={f.maxLength}
                  disabled={busy}
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          {formError ? (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={cancelEdit}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              Salvar e confirmar
            </Button>
          </div>
        </form>
      ) : null}

      {decidable && !editing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => confirmSuggestion(id), "Sugestão confirmada e gravada.")}
          >
            Confirmar
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(true)}>
            Editar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => dismissSuggestion(id), "Sugestão descartada.")}
          >
            Descartar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type TranscriptState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; text: string | null };

const SOURCE_TEXT: Record<TranscriptSource, { show: string; hide: string; loading: string; error: string; missing: string }> = {
  transcript: {
    show: "Ver transcrição",
    hide: "Ocultar transcrição",
    loading: "Carregando transcrição…",
    error: "Não foi possível carregar a transcrição. Feche e abra de novo para tentar outra vez.",
    missing: "A transcrição não está disponível.",
  },
  gemini_notes: {
    show: "Ver anotações do Gemini",
    hide: "Ocultar anotações do Gemini",
    loading: "Carregando anotações do Gemini…",
    error: "Não foi possível carregar as anotações do Gemini. Feche e abra de novo para tentar outra vez.",
    missing: "As anotações do Gemini não estão disponíveis.",
  },
};

/**
 * "Ver transcrição" (ou "Ver anotações do Gemini", quando a reunião não teve transcrição): expande e busca o
 * texto só na primeira abertura (pode ter até 1 MB).
 */
function TranscriptToggle({ meetingId, source }: { meetingId: string; source: TranscriptSource }) {
  const label = SOURCE_TEXT[source];
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TranscriptState>({ status: "idle" });

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || (state.status !== "idle" && state.status !== "error")) return;
    setState({ status: "loading" });
    try {
      setState({ status: "ready", text: await getMeetingTranscript(meetingId) });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => void toggle()}>
          {open ? label.hide : label.show}
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
        </Button>
      </div>
      {open ? (
        <div id={panelId}>
          {state.status === "loading" || state.status === "idle" ? (
            <p className="text-sm text-muted-foreground">{label.loading}</p>
          ) : state.status === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {label.error}
            </p>
          ) : state.text?.trim() ? (
            <pre
              className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-sans text-xs"
              data-testid="meeting-transcript"
            >
              {state.text}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">{label.missing}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Reunião do Meet no histórico do card: título e data, as notas do assistente (resumo, dores, objeções,
 * qualificação e próximos passos), as sugestões para decidir e a transcrição (ou as anotações do Gemini) sob
 * demanda.
 */
export function MeetingBlock({ meeting }: { meeting: RecordMeeting }) {
  return (
    <div id={meetingAnchor(meeting.id)} className="scroll-mt-4 rounded-md border bg-card" data-testid="meeting-block">
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-semibold" title={meeting.title}>
              {meeting.title}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(meeting.startedAt)}</span>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">Reunião (Meet)</span>
            {meeting.transcriptSource === "gemini_notes" ? <span>Notas feitas a partir das anotações do Gemini</span> : null}
            {meeting.status === "processing" ? <span>Processando…</span> : null}
          </p>
        </div>

        {meeting.notes ? (
          <NotesView notes={meeting.notes} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {meeting.status === "processing"
              ? "As notas desta reunião estão sendo geradas e aparecem aqui assim que ficarem prontas."
              : "Esta reunião não tem notas."}
          </p>
        )}

        {meeting.suggestions.length > 0 ? (
          <Section title="Sugestões do assistente">
            <ul className="flex flex-col gap-2">
              {meeting.suggestions.map((s) => (
                <li key={s.id}>
                  <SuggestionRow suggestion={s} canEdit={meeting.canEdit} />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {meeting.transcriptSource ? <TranscriptToggle meetingId={meeting.id} source={meeting.transcriptSource} /> : null}
      </div>
    </div>
  );
}
