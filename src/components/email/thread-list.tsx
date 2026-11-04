"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { unlinkEmailThread } from "@/lib/gmail/actions";
import { threadParticipants, type RecordThread } from "@/lib/gmail/thread-view";
import { formatDate } from "@/lib/records/format";
import { MessageView } from "./message-view";

function ThreadItem({ thread, extra }: { thread: RecordThread; extra?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = thread.messages[thread.messages.length - 1];
  const subject = thread.subject.trim() || "(sem assunto)";
  const panelId = `email-thread-${thread.threadId}`;

  async function unlink() {
    if (!window.confirm("Desvincular esta conversa do registro? Ela não volta sozinha.")) return;
    setBusy(true);
    try {
      const res = await unlinkEmailThread(thread.linkId, pathname);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Conversa desvinculada.");
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border bg-card" data-testid="email-thread">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-col gap-0.5 p-3 text-left"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-medium">{subject}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatDate(thread.lastMessageAt)}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {threadParticipants(thread.messages)}
          {thread.messages.length > 1 ? ` · ${thread.messages.length} mensagens` : ""}
        </span>
        {!open && last?.snippet ? (
          <span className="truncate text-xs text-muted-foreground">{last.snippet}</span>
        ) : null}
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-2 border-t p-3">
          {thread.accountEmail && (
            <p className="text-xs text-muted-foreground">
              Caixa: {thread.accountEmail}
              {thread.isMine ? " (sua)" : ""}
            </p>
          )}
          {thread.messages.map((m, i) => (
            <MessageView key={m.id} message={m} subject={subject} defaultOpen={i === thread.messages.length - 1} />
          ))}
          <div className="flex items-center justify-end gap-2">
            {extra}
            {thread.canUnlink && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void unlink()}>
                Desvincular
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Conversas vinculadas ao card, da mais recente para a mais antiga.
 * Slots para a Task 8: `actions` (ex.: "Novo e-mail") e `threadActions[threadId]` (ex.: "Responder").
 */
export function ThreadList({
  threads,
  actions,
  threadActions,
}: {
  threads: RecordThread[];
  actions?: ReactNode;
  threadActions?: Record<string, ReactNode>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {actions ? <div className="flex justify-end gap-2">{actions}</div> : null}
      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum e-mail vinculado a este registro. Conecte sua caixa Gmail em{" "}
          <Link href="/perfil" className="text-primary underline underline-offset-2">
            Perfil
          </Link>{" "}
          para os e-mails aparecerem aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {threads.map((t) => (
            <ThreadItem key={t.threadId} thread={t} extra={threadActions?.[t.threadId]} />
          ))}
        </ul>
      )}
    </div>
  );
}
