import { Suspense } from "react";
import { getComposeData } from "@/lib/gmail/compose-data";
import type { RecordEntity } from "@/lib/records/types";
import { InlineComposer } from "./composer";

/**
 * Aba E-mail de um card (componente servidor): o novo e-mail é escrito ali mesmo, como no Pipedrive.
 * As conversas vinculadas aparecem no histórico (RecordHistory), com o filtro E-mails.
 */
export function RecordEmail({ entity, recordId }: { entity: RecordEntity; recordId: string }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando…</p>}>
      <RecordEmailContent entity={entity} recordId={recordId} />
    </Suspense>
  );
}

async function RecordEmailContent({ entity, recordId }: { entity: RecordEntity; recordId: string }) {
  const compose = await getComposeData(entity, recordId);
  if (!compose?.canEdit) {
    return <p className="text-sm text-muted-foreground">Você não tem permissão para enviar e-mails deste registro.</p>;
  }
  return (
    <InlineComposer
      templates={compose.templates}
      vars={compose.vars}
      record={{ entity, id: recordId }}
      mailboxes={compose.mailboxes}
      initialTo={compose.suggestedTo}
    />
  );
}
