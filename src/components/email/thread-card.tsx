"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ArrowRight, ChevronDown, MessagesSquare, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/activities/time";
import { unlinkEmailThread } from "@/lib/gmail/actions";
import { threadSummary, type RecordThread } from "@/lib/gmail/thread-view";
import { cn } from "cn";
import { MessageView } from "./message-view";

/**
 * Conversa de e-mail no histórico do card, no formato do Pipedrive: assunto, quem escreveu para quem,
 * prévia e contagens. Clicar abre as mensagens ali mesmo. `extra` é o "Responder" (caixa do próprio usuário).
 */
export function ThreadCard({ thread, extra }: { thread: RecordThread; extra?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const subject = thread.subject.trim() || "(sem assunto)";
  const s = threadSummary(thread);
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
    <div className="rounded-md border bg-card" data-testid="email-thread">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-col gap-1 px-3 pt-3 text-left"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate text-sm font-semibold">{subject}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{s.at ? formatDateTime(s.at) : ""}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate font-medium text-foreground">{s.from}</span>
          {s.to ? (
            <>
              <ArrowRight className="size-3 shrink-0" aria-label="para" />
              <span className="truncate">{s.to}</span>
            </>
          ) : null}
        </span>
        {!open && s.snippet ? <span className="line-clamp-2 text-sm text-muted-foreground">{s.snippet}</span> : null}
      </button>
      <div className="flex items-center gap-3 px-3 pb-2 pt-1.5 text-xs text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5">{s.direction === "out" ? "Enviado" : "Recebido"}</span>
        {thread.source === "pipedrive" && <span className="rounded bg-muted px-1.5 py-0.5">Importado do Pipedrive</span>}
        {s.messages > 1 ? (
          <span className="flex items-center gap-1">
            <MessagesSquare className="size-3.5" aria-hidden /> {s.messages} mensagens
          </span>
        ) : null}
        {s.attachments > 0 ? (
          <span className="flex items-center gap-1">
            <Paperclip className="size-3.5" aria-hidden /> {s.attachments} {s.attachments === 1 ? "anexo" : "anexos"}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          {extra}
          <Button type="button" variant="ghost" size="sm" aria-label={open ? "Fechar conversa" : "Abrir conversa"} onClick={() => setOpen((v) => !v)}>
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </span>
      </div>
      {open && (
        <div id={panelId} className="flex flex-col gap-2 border-t p-3">
          {thread.source === "gmail" && thread.accountEmail && (
            <p className="text-xs text-muted-foreground">
              Caixa: {thread.accountEmail}
              {thread.isMine ? " (sua)" : ""}
            </p>
          )}
          {thread.messages.map((m, i) => (
            <MessageView
              key={m.id}
              message={m}
              subject={subject}
              source={thread.source}
              defaultOpen={i === thread.messages.length - 1}
            />
          ))}
          {thread.source === "gmail" && thread.canUnlink && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void unlink()}>
                Desvincular
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
