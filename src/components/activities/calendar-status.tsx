"use client";

import { Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActivityRow } from "@/lib/activities/queries";
import { retryCalendarSync } from "@/lib/calendar/settings-actions";

/**
 * Situação da atividade na Agenda do Google: o link "Entrar no Meet" (quando o evento tem videochamada) e, quando o
 * envio falhou, o aviso com "Tentar de novo". Sem nenhum dos dois, não desenha nada. O botão só aparece para quem
 * pode editar a atividade; o resultado do reenvio aparece na própria atividade, depois de atualizar a tela.
 */
export function CalendarStatus({
  activity,
  canRetry,
}: {
  activity: Pick<ActivityRow, "id" | "meetUrl" | "calendarState" | "calendarError">;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const failed = activity.calendarState === "error";
  if (!activity.meetUrl && !failed) return null;

  function retry() {
    startTransition(async () => {
      const res = await retryCalendarSync(activity.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Reenviando para a Agenda.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="calendar-status">
      {activity.meetUrl ? (
        <a
          href={activity.meetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <Video aria-hidden className="size-3.5" />
          Entrar no Meet
        </a>
      ) : null}
      {failed ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="text-destructive" title={activity.calendarError ?? undefined}>
            Agenda: não foi possível atualizar
          </span>
          {canRetry ? (
            <Button type="button" variant="outline" size="xs" disabled={pending} onClick={retry}>
              Tentar de novo
            </Button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
