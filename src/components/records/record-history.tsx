import { Suspense, type ReactNode } from "react";
import { Composer } from "@/components/email/composer";
import { replyRecipients } from "@/lib/gmail/compose";
import { getComposeData } from "@/lib/gmail/compose-data";
import { getRecordThreads } from "@/lib/gmail/queries";
import type { RecordThread } from "@/lib/gmail/thread-view";
import { getRecordMeetings } from "@/lib/meet/queries";
import { getRecordPipedriveThreads } from "@/lib/pipedrive-mail/queries";
import { dropImportedDuplicates } from "@/lib/pipedrive-mail/view";
import type { RecordEntity } from "@/lib/records/types";
import type { TimelineItem } from "@/lib/timeline/queries";
import { Timeline } from "./timeline";

type Props = { entity: RecordEntity; recordId: string; items: TimelineItem[]; planned?: ReactNode };

/**
 * Histórico do card (componente servidor): eventos e anotações já carregados mais as conversas de e-mail e
 * as reuniões do Meet, que chegam depois (Suspense, em paralelo) para não segurar o resto da página.
 * As atividades planejadas ficam fora do Suspense: dentro dele, a lista era montada de novo quando os e-mails
 * chegavam, e a janela de "Concluir" aberta nesse meio-tempo sumia.
 */
export function RecordHistory({ planned, ...props }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Planejado">
        <h3 className="mb-1 font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">Planejado</h3>
        {planned ?? <p className="text-sm text-muted-foreground">Nenhuma atividade planejada.</p>}
      </section>
      <Suspense fallback={<Timeline items={props.items} emailsLoading />}>
        <RecordHistoryContent {...props} />
      </Suspense>
    </div>
  );
}

async function RecordHistoryContent({ entity, recordId, items }: Omit<Props, "planned">) {
  // Se a parte de e-mail falhar, o histórico segue sem as conversas; as reuniões falham em silêncio dentro da consulta.
  // Os e-mails importados do Pipedrive vêm junto e também falham sem derrubar o resto.
  const [gmail, imported, compose, meetings] = await Promise.all([
    getRecordThreads(entity, recordId).catch((e: unknown) => {
      console.error("[historico] e-mails:", e);
      return [] as RecordThread[];
    }),
    getRecordPipedriveThreads(entity, recordId).catch((e: unknown) => {
      console.error("[historico] e-mails do Pipedrive:", e);
      return [] as RecordThread[];
    }),
    getComposeData(entity, recordId).catch(() => null),
    getRecordMeetings(entity, recordId),
  ]);

  // O importado que já veio pelo Gmail (mesmo Message-ID) some; o resto entra no histórico, só para leitura.
  const threads = [...gmail, ...dropImportedDuplicates(gmail, imported)];

  // "Responder" só nas conversas do Gmail da caixa do próprio usuário, para o remetente da última mensagem recebida.
  const threadActions: Record<string, ReactNode> = {};
  if (compose) {
    const record = compose.canEdit ? { entity, id: recordId } : undefined;
    for (const t of threads) {
      const last = t.messages[t.messages.length - 1];
      if (t.source !== "gmail" || !t.isMine || !last) continue;
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

  return <Timeline items={items} threads={threads} meetings={meetings} threadActions={threadActions} />;
}
