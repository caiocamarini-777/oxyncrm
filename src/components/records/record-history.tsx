import { Suspense, type ReactNode } from "react";
import { Composer } from "@/components/email/composer";
import { replyRecipients } from "@/lib/gmail/compose";
import { getComposeData } from "@/lib/gmail/compose-data";
import { getRecordThreads } from "@/lib/gmail/queries";
import type { RecordThread } from "@/lib/gmail/thread-view";
import { getRecordMeetings } from "@/lib/meet/queries";
import type { RecordEntity } from "@/lib/records/types";
import type { TimelineItem } from "@/lib/timeline/queries";
import { Timeline } from "./timeline";

type Props = { entity: RecordEntity; recordId: string; items: TimelineItem[]; planned?: ReactNode };

/**
 * Histórico do card (componente servidor): eventos e anotações já carregados mais as conversas de e-mail e
 * as reuniões do Meet, que chegam depois (Suspense, em paralelo) para não segurar o resto da página.
 */
export function RecordHistory(props: Props) {
  return (
    <Suspense fallback={<Timeline items={props.items} planned={props.planned} emailsLoading />}>
      <RecordHistoryContent {...props} />
    </Suspense>
  );
}

async function RecordHistoryContent({ entity, recordId, items, planned }: Props) {
  // Se a parte de e-mail falhar, o histórico segue sem as conversas; as reuniões falham em silêncio dentro da consulta.
  const [threads, compose, meetings] = await Promise.all([
    getRecordThreads(entity, recordId).catch((e: unknown) => {
      console.error("[historico] e-mails:", e);
      return [] as RecordThread[];
    }),
    getComposeData(entity, recordId).catch(() => null),
    getRecordMeetings(entity, recordId),
  ]);

  // "Responder" só nas conversas da caixa do próprio usuário, para o remetente da última mensagem recebida.
  const threadActions: Record<string, ReactNode> = {};
  if (compose) {
    const record = compose.canEdit ? { entity, id: recordId } : undefined;
    for (const t of threads) {
      const last = t.messages[t.messages.length - 1];
      if (!t.isMine || !last) continue;
      threadActions[t.threadId] = (
        <Composer
          label="Responder"
          templates={compose.templates}
          vars={compose.vars}
          record={record}
          mailboxes={compose.mailboxes.filter((m) => m.id === t.accountId)}
          initialAccountId={t.accountId}
          initialTo={replyRecipients(t.messages)}
          initialSubject={t.subject}
          reply={{ gmailThreadId: t.gmailThreadId, replyToGmailMessageId: last.gmailMessageId }}
        />
      );
    }
  }

  return <Timeline items={items} planned={planned} threads={threads} meetings={meetings} threadActions={threadActions} />;
}
