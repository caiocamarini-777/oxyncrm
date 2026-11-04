"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "@/lib/records/format";
import { formatTime } from "@/lib/activities/time";
import {
  buildEmailSrcdoc,
  clampIframeHeight,
  formatAddress,
  MIN_IFRAME_HEIGHT,
  type ThreadMessageView,
} from "@/lib/gmail/thread-view";

/**
 * HTML do e-mail em iframe sem scripts (sem `allow-scripts` e com CSP `default-src 'none'`).
 * `allow-same-origin` só serve para medir a altura; `allow-popups` deixa os links abrirem em nova aba.
 */
function HtmlBody({ html, title }: { html: string; title: string }) {
  const srcDoc = useMemo(() => buildEmailSrcdoc(html), [html]);
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

export function MessageView({ message, subject }: { message: ThreadMessageView; subject: string }) {
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
      {message.bodyHtml ? (
        <HtmlBody html={message.bodyHtml} title={`Mensagem: ${subject || "(sem assunto)"}`} />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">{message.bodyText || message.snippet}</p>
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
