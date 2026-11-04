import { getComposeData } from "@/lib/gmail/compose-data";
import { replyRecipients } from "@/lib/gmail/compose";
import { getRecordThreads } from "@/lib/gmail/queries";
import type { RecordEntity } from "@/lib/records/types";
import { Composer } from "./composer";
import { ThreadList } from "./thread-list";

/**
 * Conteúdo da aba E-mail de um card (componente servidor): conversas vinculadas, "Novo e-mail" e,
 * nas conversas da caixa do próprio usuário, "Responder" (para o remetente da última mensagem recebida).
 */
export async function RecordEmail({ entity, recordId }: { entity: RecordEntity; recordId: string }) {
  const [threads, compose] = await Promise.all([getRecordThreads(entity, recordId), getComposeData(entity, recordId)]);
  if (!compose) return <ThreadList threads={threads} />;

  const record = compose.canEdit ? { entity, id: recordId } : undefined;
  const common = { templates: compose.templates, vars: compose.vars, record };

  const threadActions: Record<string, React.ReactNode> = {};
  for (const t of threads) {
    const last = t.messages[t.messages.length - 1];
    if (!t.isMine || !last) continue;
    threadActions[t.threadId] = (
      <Composer
        {...common}
        label="Responder"
        mailboxes={compose.mailboxes.filter((m) => m.id === t.accountId)}
        initialAccountId={t.accountId}
        initialTo={replyRecipients(t.messages)}
        initialSubject={t.subject}
        reply={{ gmailThreadId: t.gmailThreadId, replyToGmailMessageId: last.gmailMessageId }}
      />
    );
  }

  return (
    <ThreadList
      threads={threads}
      actions={
        compose.canEdit ? <Composer {...common} label="Novo e-mail" mailboxes={compose.mailboxes} initialTo={compose.suggestedTo} /> : undefined
      }
      threadActions={threadActions}
    />
  );
}
