"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteNote, updateNote } from "@/lib/notes/actions";
import { linkify } from "@/lib/timeline/describe";
import type { TimelineItem } from "@/lib/timeline/queries";
import { formatDate } from "@/lib/records/format";

function NoteBody({ body }: { body: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm">
      {linkify(body).map((c, i) =>
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

function NoteCard({ item }: { item: TimelineItem }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const note = item.note!;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
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
    <li className="rounded-md border bg-card p-3" data-testid="timeline-note">
      <p className="mb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{item.actorName}</span> · {formatDate(item.at)}
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea aria-label="Editar anotação" rows={4} maxLength={10000} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(false); setDraft(note.body); }}>
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
    </li>
  );
}

export function Timeline({ items, planned }: { items: TimelineItem[]; planned?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Planejado">
        <h3 className="mb-1 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planejado</h3>
        {planned ?? <p className="text-sm text-muted-foreground">Nenhuma atividade planejada.</p>}
      </section>
      <section aria-label="Histórico">
        <h3 className="mb-2 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada por aqui ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item, i) =>
              item.note ? (
                <NoteCard key={`n-${item.note.id}`} item={item} />
              ) : (
                <li key={i} className="px-1 text-sm" data-testid="timeline-event">
                  <span className="font-medium">{item.actorName}</span>: {item.text}
                  <span className="text-xs text-muted-foreground"> · {formatDate(item.at)}</span>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
