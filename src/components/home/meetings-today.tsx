import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/activities/time";
import { successRate, type HeldMeeting, type HomeMeetings, type ScheduledMeeting, type ScheduledSituation } from "@/lib/meet/home";
import { UnlinkedMeetings } from "./unlinked-meetings";

const ENTITY_LABEL = { deals: "Negócio", leads: "Lead", persons: "Pessoa", organizations: "Organização" } as const;

const SITUATION: Record<ScheduledSituation, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  realizada: { label: "Realizada", variant: "default" },
  a_fazer: { label: "A fazer", variant: "secondary" },
  nao_realizada: { label: "Não realizada", variant: "destructive" },
};

const titleClass = "font-heading text-xs uppercase tracking-wide text-muted-foreground";

function ScheduledItem({ m, showCompany }: { m: ScheduledMeeting; showCompany: boolean }) {
  const s = SITUATION[m.situation];
  return (
    <li className="flex items-start gap-3 py-2" data-testid="home-scheduled-row" data-situation={m.situation}>
      <span className="w-11 shrink-0 pt-0.5 text-sm tabular-nums text-muted-foreground">{formatTime(m.dueAt)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words">{m.subject}</p>
        <p className="text-xs text-muted-foreground">
          {m.record ? (
            <Link href={m.record.href} className="break-words underline-offset-3 hover:underline">
              {ENTITY_LABEL[m.record.entity]}: {m.record.title || "Sem nome"}
            </Link>
          ) : (
            "Sem card vinculado"
          )}
          {showCompany && m.companyName ? ` · ${m.companyName}` : ""}
        </p>
      </div>
      <Badge variant={s.variant}>{s.label}</Badge>
    </li>
  );
}

function HeldItem({ m, showCompany }: { m: HeldMeeting; showCompany: boolean }) {
  return (
    <li className="py-2" data-testid="home-held-row">
      <Link href={m.href} className="text-sm font-medium break-words underline-offset-3 hover:underline">
        {m.title}
      </Link>
      <p className="text-xs text-muted-foreground">
        {ENTITY_LABEL[m.record.entity]}: {m.record.title || "Sem nome"} · encerrada às {formatTime(m.endedAt)}
        {showCompany && m.companyName ? ` · ${m.companyName}` : ""}
      </p>
      {m.excerpt ? (
        <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">{m.excerpt}</p>
      ) : m.processing ? (
        <p className="mt-1 text-sm text-muted-foreground">As notas estão sendo geradas.</p>
      ) : null}
    </li>
  );
}

/**
 * Reuniões do dia na tela inicial: indicador "Realizadas X de Y", lista das marcadas hoje, lista das do Meet
 * encerradas hoje e, só quando há, o bloco Sem vínculo.
 */
export function MeetingsToday({ data, showCompany }: { data: HomeMeetings; showCompany: boolean }) {
  const rate = successRate(data.scheduled);
  return (
    <div className="grid gap-4" data-testid="home-meetings">
      <Card className="max-w-sm" data-testid="home-meetings-rate">
        <CardHeader>
          <CardTitle className={titleClass}>Reuniões do dia</CardTitle>
        </CardHeader>
        <CardContent>
          {data.scheduledFailed ? (
            <p role="alert" className="text-sm text-muted-foreground">
              Não foi possível carregar as reuniões de hoje agora.
            </p>
          ) : rate.pct === null ? (
            <p className="text-sm text-muted-foreground">Nenhuma reunião marcada hoje</p>
          ) : (
            <>
              <p className="font-heading text-3xl font-semibold">
                {rate.done} de {rate.total}
              </p>
              <p className="text-sm text-muted-foreground">Realizadas ({rate.pct}%)</p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className={titleClass}>Reuniões de hoje</CardTitle>
          </CardHeader>
          <CardContent>
            {data.scheduled.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {data.scheduledFailed ? "Tente novamente em instantes." : "Nenhuma reunião marcada hoje."}
              </p>
            ) : (
              <ul className="divide-y">
                {data.scheduled.map((m) => (
                  <ScheduledItem key={m.id} m={m} showCompany={showCompany} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className={titleClass}>Realizadas hoje (Meet)</CardTitle>
          </CardHeader>
          <CardContent>
            {data.heldToday.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma reunião do Meet encerrada hoje.</p>
            ) : (
              <ul className="divide-y">
                {data.heldToday.map((m) => (
                  <HeldItem key={m.id} m={m} showCompany={showCompany} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {data.unlinked.length > 0 ? <UnlinkedMeetings rows={data.unlinked} showCompany={showCompany} /> : null}
    </div>
  );
}
