"use client";

import { useState } from "react";
import { DiscardMeetingDialog } from "@/components/meetings/discard-meeting-dialog";
import { LinkMeetingDialog } from "@/components/meetings/link-meeting-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/activities/time";
import { canDiscard } from "@/lib/meet/decisions";
import type { MeetingListRow } from "@/lib/meet/queries";

/**
 * Reuniões sem vínculo do usuário na tela inicial, com Vincular e Descartar iguais aos da página Reuniões
 * (mesmos diálogos e ações; o servidor confere a permissão de novo). Só é desenhada quando há alguma.
 */
export function UnlinkedMeetings({ rows, showCompany }: { rows: MeetingListRow[]; showCompany: boolean }) {
  const [linking, setLinking] = useState<MeetingListRow | null>(null);
  const [discarding, setDiscarding] = useState<MeetingListRow | null>(null);

  return (
    <Card data-testid="home-unlinked">
      <CardHeader>
        <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">Sem vínculo</CardTitle>
        <CardDescription>
          Reuniões do Meet sem card no CRM são descartadas sozinhas em 7 dias; as de cards excluídos ficam até você vincular ou
          descartar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="home-unlinked-row">
              <div className="min-w-0">
                <p className="text-sm font-medium break-words">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[formatDateTime(r.startedAt), showCompany ? r.companyName : "", r.recordTrashed ? "Registro na lixeira" : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex gap-2">
                {r.canAct ? (
                  <Button variant="outline" size="sm" onClick={() => setLinking(r)}>
                    Vincular
                  </Button>
                ) : null}
                {r.canAct && canDiscard(r.status, r.recordTrashed) ? (
                  <Button variant="destructive" size="sm" onClick={() => setDiscarding(r)}>
                    Descartar
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      {linking ? (
        <LinkMeetingDialog
          meeting={{
            id: linking.id,
            title: linking.title,
            companyId: linking.companyId,
            companyName: linking.companyName,
            companySlug: linking.companySlug,
          }}
          open
          onOpenChange={(o) => !o && setLinking(null)}
        />
      ) : null}
      <DiscardMeetingDialog meeting={discarding} onOpenChange={(o) => !o && setDiscarding(null)} />
    </Card>
  );
}
