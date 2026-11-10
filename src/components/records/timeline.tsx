"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import {
  ArrowRightLeft,
  CalendarCheck,
  CalendarClock,
  Circle,
  Flag,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  StickyNote,
  Tag,
  Trash2,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ThreadCard } from "@/components/email/thread-card";
import { MeetingBlock } from "@/components/meetings/meeting-block";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteNote, updateNote } from "@/lib/notes/actions";
import { formatDateTime } from "@/lib/activities/time";
import { threadSummary, type RecordThread } from "@/lib/gmail/thread-view";
import type { RecordMeeting } from "@/lib/meet/queries";
import { linkify, noteText, sortByAtDesc, timelineCategory, type TimelineCategory } from "@/lib/timeline/describe";
import type { TimelineItem } from "@/lib/timeline/queries";
import { cn } from "cn";

function NoteBody({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {linkify(noteText(body)).map((c, i) =>
        c.type === "link" ? (
          <a
            key={i}
            href={c.value}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {c.value}
          </a>
        ) : (
          <span key={i}>{c.value}</span>
        ),
      )}
    </p>
  );
}

/** Anotação em amarelo, como no Pipedrive. Ao editar uma importada em HTML, o texto vai limpo. */
function NoteCard({ item }: { item: TimelineItem }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const note = item.note!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => noteText(note.body));
  const [busy, setBusy] = useState(false);

  async function run(fn: () => ReturnType<typeof updateNote>, done?: () => void) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      done?.();
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30"
      data-testid="timeline-note"
    >
      <p className="mb-1 flex justify-between gap-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{item.actorName}</span>
        <span>{formatDateTime(item.at)}</span>
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Editar anotação" rows={4} maxLength={10000} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(false); setDraft(noteText(note.body)); }}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || draft.trim().length === 0}
              onClick={() => void run(() => updateNote(note.id, draft), () => setEditing(false))}
            >
              Salvar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <NoteBody body={note.body} />
          {note.canEdit && (
            <div className="mt-2 flex gap-3 text-xs">
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>
                Editar
              </button>
              <button
                type="button"
                disabled={busy}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (window.confirm("Excluir esta anotação?")) void run(() => deleteNote(note.id));
                }}
              >
                Excluir
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const EVENT_ICONS: Record<string, LucideIcon> = {
  note: StickyNote,
  activity_scheduled: CalendarClock,
  activity_completed: CalendarCheck,
  stage_changed: ArrowRightLeft,
  owner_changed: UserRound,
  status_changed: Flag,
  converted: Flag,
  label_added: Tag,
  label_removed: Tag,
  created: Plus,
  trashed: Trash2,
  restored: RotateCcw,
  updated: Pencil,
};

type Filter = "all" | TimelineCategory | "email";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tudo" },
  { key: "note", label: "Anotações" },
  { key: "activity", label: "Atividades" },
  { key: "email", label: "E-mails" },
  { key: "change", label: "Alterações" },
];

type Entry =
  | { at: string; category: TimelineCategory; item: TimelineItem; key: string }
  | { at: string; category: "email"; thread: RecordThread; key: string }
  // Reunião do Meet: entra no filtro "Atividades", ordenada pelo início da reunião.
  | { at: string; category: "activity"; meeting: RecordMeeting; key: string };

/** Um item do histórico: ícone no trilho à esquerda e o conteúdo ao lado. */
function RailItem({ icon: Icon, last, children }: { icon: LucideIcon; last: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-3">
      {!last && <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-border" />}
      <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function EntryContent({ entry, threadActions }: { entry: Entry; threadActions?: Record<string, ReactNode> }) {
  if ("thread" in entry) return <ThreadCard thread={entry.thread} extra={threadActions?.[entry.thread.threadId]} />;
  if ("meeting" in entry) return <MeetingBlock meeting={entry.meeting} />;
  const { item } = entry;
  if (item.note) return <NoteCard item={item} />;
  if (entry.category === "activity") {
    return (
      <div className="rounded-md border bg-card p-3 text-sm" data-testid="timeline-event">
        <p className="flex justify-between gap-3">
          <span className="font-medium">{item.text}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(item.at)}</span>
        </p>
        {item.detail ? <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{item.detail}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground">
          {item.kind === "activity_completed" ? "Concluída" : "Agendada"} por {item.actorName}
        </p>
      </div>
    );
  }
  return (
    <p className="pt-1 text-sm text-muted-foreground" data-testid="timeline-event">
      <span className="font-medium text-foreground">{item.actorName}</span>: {item.text}
      <span className="text-xs"> · {formatDateTime(item.at)}</span>
    </p>
  );
}

/**
 * Histórico do card no formato do Pipedrive: filtros (Tudo, Anotações, Atividades, E-mails, Alterações),
 * trilho com ícones, as conversas de e-mail como cards e as reuniões do Meet como blocos (em Atividades).
 * `emailsLoading`: as conversas ainda estão chegando. As atividades planejadas ficam em `RecordHistory`.
 */
export function Timeline({
  items,
  threads = [],
  meetings = [],
  threadActions,
  emailsLoading = false,
}: {
  items: TimelineItem[];
  threads?: RecordThread[];
  meetings?: RecordMeeting[];
  threadActions?: Record<string, ReactNode>;
  emailsLoading?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const entries = useMemo(() => {
    const list: Entry[] = [
      ...items.map((item, i) => ({
        at: item.at,
        category: timelineCategory(item.kind),
        item,
        key: item.note ? `n-${item.note.id}` : `e-${i}`,
      })),
      ...threads.map((thread) => ({
        at: threadSummary(thread).at,
        category: "email" as const,
        thread,
        key: `t-${thread.threadId}`,
      })),
      ...meetings.map((meeting) => ({
        at: meeting.startedAt,
        category: "activity" as const,
        meeting,
        key: `m-${meeting.id}`,
      })),
    ];
    return sortByAtDesc(list);
  }, [items, threads, meetings]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: entries.length, note: 0, activity: 0, email: 0, change: 0 };
    for (const e of entries) c[e.category] += 1;
    return c;
  }, [entries]);
  const visible = filter === "all" ? entries : entries.filter((e) => e.category === filter);

  return (
    <section aria-label="Histórico">
      <h3 className="mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h3>
      <div role="group" aria-label="Filtrar histórico" className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              filter === f.key ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
            {f.key !== "all" && counts[f.key] > 0 ? <span className="ml-1 opacity-80">{counts[f.key]}</span> : null}
          </button>
        ))}
      </div>
      {emailsLoading && (filter === "all" || filter === "email") ? (
        <p className="mb-2 text-xs text-muted-foreground">Carregando e-mails…</p>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {filter === "email" && !emailsLoading
            ? "Nenhum e-mail vinculado a este registro. As conversas com os contatos dele aparecem aqui quando a caixa Gmail está conectada no Perfil."
            : "Nada por aqui ainda."}
        </p>
      ) : (
        <ol className="flex flex-col">
          {visible.map((entry, i) => (
            <RailItem
              key={entry.key}
              icon={"thread" in entry ? Mail : "meeting" in entry ? Video : (EVENT_ICONS[entry.item.kind] ?? Circle)}
              last={i === visible.length - 1}
            >
              <EntryContent entry={entry} threadActions={threadActions} />
            </RailItem>
          ))}
        </ol>
      )}
    </section>
  );
}
