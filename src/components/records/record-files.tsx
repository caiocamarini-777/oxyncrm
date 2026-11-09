import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRecordFiles } from "@/lib/pipedrive-mail/queries";
import { formatFileSize, type RecordFileView } from "@/lib/pipedrive-mail/view";
import { formatDate } from "@/lib/records/format";
import type { RecordEntity } from "@/lib/records/types";
import { RecordFileButton } from "./record-file-button";

/**
 * Arquivos do card (componente servidor): os importados do Pipedrive. Chegam depois do resto da página
 * (Suspense) e, sem arquivos, nada aparece.
 */
export function RecordFiles({ entity, recordId }: { entity: RecordEntity; recordId: string }) {
  return (
    <Suspense fallback={null}>
      <RecordFilesContent entity={entity} recordId={recordId} />
    </Suspense>
  );
}

async function RecordFilesContent({ entity, recordId }: { entity: RecordEntity; recordId: string }) {
  // A consulta já falha em silêncio; o catch cobre o que escapar (a página do registro nunca quebra por isto).
  const files = await getRecordFiles(entity, recordId).catch((e: unknown) => {
    console.error("[arquivos] lista:", e);
    return [] as RecordFileView[];
  });
  if (files.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Arquivos ({files.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y" data-testid="record-files">
          {files.map((f) => {
            const meta = [formatFileSize(f.size), formatDate(f.createdAt)].filter(Boolean).join(" · ");
            return (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={f.filename}>
                    {f.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">{meta}</p>
                  {!f.available && <p className="text-xs text-muted-foreground">Não trazido do Pipedrive (maior que 25 MB)</p>}
                </div>
                {f.available && <RecordFileButton fileId={f.id} filename={f.filename} remote={f.remote} />}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
