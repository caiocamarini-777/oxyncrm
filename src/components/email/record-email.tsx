import { getRecordThreads } from "@/lib/gmail/queries";
import type { RecordEntity } from "@/lib/records/types";
import { ThreadList } from "./thread-list";

/**
 * Conteúdo da aba E-mail de um card (componente servidor).
 * A Task 8 passa "Novo e-mail" em `actions` e o "Responder" de cada conversa em `threadActions`.
 */
export async function RecordEmail({ entity, recordId }: { entity: RecordEntity; recordId: string }) {
  const threads = await getRecordThreads(entity, recordId);
  return <ThreadList threads={threads} />;
}
