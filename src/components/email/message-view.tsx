"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "@/lib/records/format";
import { formatTime } from "@/lib/activities/time";
import { Button } from "@/components/ui/button";
import { getEmailMessageBody, type EmailMessageBody } from "@/lib/gmail/message-body-actions";
import {
  buildEmailSrcdoc,
  clampIframeHeight,
  formatAddress,
  hasRemoteImages,
  MIN_IFRAME_HEIGHT,
  type ThreadMessageView,
} from "@/lib/gmail/thread-view";

/**
 * HTML do e-mail em iframe sem scripts (sem `allow-scripts` e com CSP `default-src 'none'`).
 * `allow-same-origin` só serve para medir a altura; `allow-popups` deixa os links abrirem em nova aba.
 */
function HtmlBody({ html, title }: { html: string; title: string }) {
  // Imagens remotas ficam bloqueadas (rastreamento) até o usuário pedir, por mensagem.
  const [showImages, setShowImages] = useState(false);
  const remote = useMemo(() => hasRemoteImages(html), [html]);
  const srcDoc = useMemo(() => buildEmailSrcdoc(html, { showImages }), [html, showImages]);
  const [height, setHeight] = useState(240);
  const observer = useRef<ResizeObserver | null>(null);

  useEffect(() => () => observer.current?.disconnect(), []);

  function measure(frame: HTMLIFrameElement) {
    const doc = frame.contentDocument;
    if (!doc?.documentElement) return;
    setHeight(clampIframeHeight(doc.documentElement.scrollHeight));
    // Imagens carregam depois do onLoad; o quadro também pode estar oculto (aba fechada) ao carregar.
    observer.current?.disconnect();
    const RO = frame.contentWindow && (frame.contentWindow as Window & typeof globalThis).ResizeObserver;
    if (!RO) return;
    observer.current = new RO(() => {
      setHeight(clampIframeHeight(doc.documentElement.scrollHeight));
    });
    observer.current.observe(doc.documentElement);
  }

  return (
    <>
      {remote && !showImages && (
        <div className="flex items-center justify-between gap-2 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          <span>Imagens remotas bloqueadas.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowImages(true)}>
            Mostrar imagens
          </Button>
        </div>
      )}
      <iframe
      title={title}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      onLoad={(e) => measure(e.currentTarget)}
      style={{ height: Math.max(height, MIN_IFRAME_HEIGHT) }}
      className="w-full rounded border bg-white"
      data-testid="email-html"
      />
    </>
  );
}

function Recipients({ label, list }: { label: string; list: { email: string; name: string | null }[] }) {
  if (list.length === 0) return null;
  return (
    <p>
      <span className="font-medium text-foreground">{label}:</span> {list.map(formatAddress).join(", ")}
    </p>
  );
}

type BodyState = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; body: EmailMessageBody };

/** Carrega o corpo ao montar (a mensagem só monta quando a conversa/mensagem está aberta). */
function MessageBody({ message, subject }: { message: ThreadMessageView; subject: string }) {
  const inline = message.bodyHtml !== undefined || message.bodyText !== undefined;
  const [state, setState] = useState<BodyState>(
    inline ? { status: "ready", body: { html: message.bodyHtml ?? null, text: message.bodyText ?? null } } : { status: "loading" },
  );

  useEffect(() => {
    if (inline) return; // caixa ao vivo: o corpo já veio com a mensagem
    let cancelled = false;
    getEmailMessageBody(message.id)
      .then((res) => {
        if (cancelled) return;
        setState(res.ok ? { status: "ready", body: res.data } : { status: "error", error: res.error });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", error: "Não foi possível carregar a mensagem." });
      });
    return () => {
      cancelled = true;
    };
  }, [message.id, inline]);

  if (state.status === "loading") {
    return <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{message.snippet || "Carregando…"}</p>;
  }
  if (state.status === "error") {
    return (
      <>
        <p className="text-xs text-destructive">{state.error}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{message.snippet}</p>
      </>
    );
  }
  const { html, text } = state.body;
  return html ? (
    <HtmlBody html={html} title={`Mensagem: ${subject || "(sem assunto)"}`} />
  ) : (
    <p className="whitespace-pre-wrap break-words text-sm">{text || message.snippet}</p>
  );
}

/** `defaultOpen`: a última mensagem da conversa abre sozinha; as outras abrem sob demanda. */
export function MessageView({
  message,
  subject,
  defaultOpen = true,
}: {
  message: ThreadMessageView;
  subject: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const from = formatAddress({ email: message.fromEmail, name: message.fromName });
  return (
    <article className="flex flex-col gap-2 rounded-md border bg-card p-3" data-testid="email-message">
      <header className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">De:</span> {from}
          <span> · {formatDate(message.sentAt)}, {formatTime(message.sentAt)}</span>
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5">{message.direction === "out" ? "Enviado" : "Recebido"}</span>
        </p>
        <Recipients label="Para" list={message.to} />
        <Recipients label="Cc" list={message.cc} />
      </header>
      {open ? (
        <MessageBody message={message} subject={subject} />
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm text-muted-foreground">{message.snippet}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Abrir mensagem
          </Button>
        </div>
      )}
      {message.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Anexos">
          {message.attachments.map((a, i) => (
            <li key={i} className="rounded border bg-muted px-2 py-0.5">
              {a.filename}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
