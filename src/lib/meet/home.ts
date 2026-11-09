import "server-only";
import { toActivityRow, SELECT, type ActivityRow, type RawRow } from "@/lib/activities/rows";
import { dayKey, startOfDayUtc, startOfNextDayUtc } from "@/lib/activities/time";
import { recordHref, type RecordEntity } from "@/lib/records/types";
import { createServerClient } from "@/lib/supabase/server";
import {
  listOwnEndedMeetings,
  listOwnUnlinkedMeetings,
  type EndedMeeting,
  type MeetingListRecord,
  type MeetingListRow,
} from "./queries";
import { meetingAnchor } from "./view";

/**
 * Reuniões do dia na tela inicial (`/[empresa]/inicio`): as marcadas na agenda do usuário (atividades de reunião),
 * as do Meet encerradas hoje e as sem vínculo. Tudo é do usuário logado, nas empresas do escopo, e o dia é o de
 * São Paulo. A parte das atividades usa tabelas que já existem; as consultas de `meetings` falham em silêncio
 * (log e vazio), porque as tabelas podem não existir ainda.
 */

/** Tolerância depois do horário marcado: passou mais de 1 h sem Meet e sem conclusão, a reunião não aconteceu. */
const GRACE_MS = 3600_000;
/** Atividades do dia lidas (de todos os tipos; as de reunião saem em memória). */
const SCHEDULED_LIMIT = 500;
/** Linhas do resumo mostradas em "Realizadas hoje" e tamanho máximo de cada uma. */
const EXCERPT_LINES = 2;
const EXCERPT_LINE_CHARS = 240;

/** Hoje em São Paulo, em ISO UTC: início do dia (inclusive) e início do dia seguinte (exclusive). */
export function todayRange(now: Date): { start: string; end: string } {
  const key = dayKey(now);
  return { start: startOfDayUtc(key), end: startOfNextDayUtc(key) };
}

export type ScheduledSituation = "realizada" | "a_fazer" | "nao_realizada";

/**
 * Situação de uma reunião marcada hoje. (O nome `meetingSituation` já existe em `view.ts`, para o texto da
 * página Reuniões; esta é a das atividades.)
 * - realizada: tem reunião do Meet ligada, ou foi concluída com o resultado "held";
 * - a fazer: ainda não concluída e o horário mais 1 h não passou (exatamente 1 h ainda é a fazer);
 * - não realizada: os demais casos, inclusive a concluída com outro resultado (cancelada, não compareceu,
 *   remarcada), que nunca volta a ser "a fazer".
 */
export function scheduledSituation(
  a: { dueAt: string; done: boolean; meetingOutcome: string | null; hasMeet: boolean },
  now: Date,
): ScheduledSituation {
  if (a.hasMeet || (a.done && a.meetingOutcome === "held")) return "realizada";
  if (a.done) return "nao_realizada";
  return now.getTime() <= Date.parse(a.dueAt) + GRACE_MS ? "a_fazer" : "nao_realizada";
}

/** Indicador do dia: quantas das marcadas foram realizadas. `pct` é inteiro e fica nulo sem reuniões marcadas. */
export function successRate(items: { situation: ScheduledSituation }[]): { done: number; total: number; pct: number | null } {
  const total = items.length;
  const done = items.filter((i) => i.situation === "realizada").length;
  return { done, total, pct: total === 0 ? null : Math.round((done / total) * 100) };
}

/** As duas primeiras linhas com texto do resumo (sem as vazias), cada uma cortada em 240 caracteres. */
export function summaryExcerpt(summary: string): string {
  return summary
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, EXCERPT_LINES)
    .map((l) => (l.length > EXCERPT_LINE_CHARS ? `${l.slice(0, EXCERPT_LINE_CHARS)}…` : l))
    .join("\n");
}

export type ScheduledMeeting = {
  id: string;
  subject: string;
  dueAt: string;
  situation: ScheduledSituation;
  companyName: string;
  /** Card vinculado que o usuário enxerga e está vivo; `null` sem vínculo legível. */
  record: MeetingListRecord | null;
};

export type HeldMeeting = {
  id: string;
  title: string;
  endedAt: string;
  /** As notas ainda estão sendo geradas. */
  processing: boolean;
  /** Duas primeiras linhas do resumo (vazio sem notas). */
  excerpt: string;
  companyName: string;
  record: MeetingListRecord;
  /** Rota do card, já no bloco da reunião no histórico. */
  href: string;
};

export type HomeMeetings = {
  /** Reuniões marcadas hoje, por horário. */
  scheduled: ScheduledMeeting[];
  /** A leitura das marcadas falhou: `scheduled` vem vazio, e a tela avisa em vez de dizer que não há reuniões. */
  scheduledFailed: boolean;
  heldToday: HeldMeeting[];
  unlinked: MeetingListRow[];
};

// Negócio primeiro: é o card que carrega o funil. Depois lead, pessoa e organização.
const RECORD_ORDER: { entity: RecordEntity; key: "deal" | "lead" | "person" | "organization" }[] = [
  { entity: "deals", key: "deal" },
  { entity: "leads", key: "lead" },
  { entity: "persons", key: "person" },
  { entity: "organizations", key: "organization" },
];

/** Atividade de reunião -> item da lista. Só conta o vínculo que o usuário lê e que não está na lixeira. */
export function toScheduledMeeting(row: ActivityRow, hasMeet: boolean, now: Date): ScheduledMeeting {
  const hit = RECORD_ORDER.find((r) => row[r.key] !== null);
  const link = hit ? row[hit.key] : null;
  return {
    id: row.id,
    subject: row.subject,
    dueAt: row.dueAt,
    situation: scheduledSituation(
      { dueAt: row.dueAt, done: row.done, meetingOutcome: row.meetingOutcome, hasMeet },
      now,
    ),
    companyName: row.companyName,
    record:
      hit && link && row.companySlug
        ? { entity: hit.entity, id: link.id, title: link.name, href: recordHref(hit.entity, row.companySlug, link.id) }
        : null,
  };
}

/** Reuniões do Meet encerradas hoje -> itens da lista, com o link para o bloco da reunião no card. */
export function toHeldToday(meetings: EndedMeeting[]): HeldMeeting[] {
  return meetings.map((m) => ({
    id: m.id,
    title: m.title,
    endedAt: m.endedAt,
    processing: m.status === "processing",
    excerpt: summaryExcerpt(m.summary),
    companyName: m.companyName,
    record: m.record,
    href: `${m.record.href}#${meetingAnchor(m.id)}`,
  }));
}

/** Atividades (entre as dadas) que têm reunião do Meet ligada. Falha em silêncio: sem elas, ninguém ganha "realizada". */
async function anchoredActivityIds(activityIds: string[]): Promise<Set<string>> {
  if (activityIds.length === 0) return new Set();
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("meetings")
      .select("anchor_activity_id")
      .in("anchor_activity_id", activityIds)
      .neq("status", "ignored");
    if (error) {
      console.error("[reunioes] tela inicial, reuniões ligadas:", error.code, error.message);
      return new Set();
    }
    const ids = (data ?? []) as unknown as { anchor_activity_id: string | null }[];
    return new Set(ids.flatMap((r) => (typeof r.anchor_activity_id === "string" ? [r.anchor_activity_id] : [])));
  } catch (e) {
    console.error("[reunioes] tela inicial, reuniões ligadas:", e);
    return new Set();
  }
}

/** Atividades de reunião do usuário com horário hoje (concluídas ou não), por horário. */
async function loadScheduled(
  userId: string,
  companyIds: string[],
  range: { start: string; end: string },
  now: Date,
): Promise<{ rows: ScheduledMeeting[]; failed: boolean }> {
  if (companyIds.length === 0) return { rows: [], failed: false };
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from("activities")
      .select(SELECT)
      .eq("owner_id", userId)
      .in("company_id", companyIds)
      .is("deleted_at", null)
      .gte("due_at", range.start)
      .lt("due_at", range.end)
      .order("due_at")
      .order("id")
      .limit(SCHEDULED_LIMIT);
    if (error) {
      console.error("[inicio] reuniões marcadas:", error.code, error.message);
      return { rows: [], failed: true };
    }
    const meetings = ((data ?? []) as unknown as RawRow[]).map((r) => toActivityRow(r, now)).filter((a) => a.type.isMeeting);
    const anchored = await anchoredActivityIds(meetings.map((a) => a.id));
    return { rows: meetings.map((a) => toScheduledMeeting(a, anchored.has(a.id), now)), failed: false };
  } catch (e) {
    console.error("[inicio] reuniões marcadas:", e);
    return { rows: [], failed: true };
  }
}

/**
 * Tudo da tela inicial: reuniões marcadas hoje (com a situação de cada uma), reuniões do Meet encerradas hoje e
 * reuniões sem vínculo, do usuário `userId` nas empresas `companyIds`.
 */
export async function getHomeMeetings(userId: string, companyIds: string[], now: Date): Promise<HomeMeetings> {
  const range = todayRange(now);
  const [scheduled, ended, unlinked] = await Promise.all([
    loadScheduled(userId, companyIds, range, now),
    listOwnEndedMeetings(userId, companyIds, range),
    listOwnUnlinkedMeetings(userId, companyIds),
  ]);
  return { scheduled: scheduled.rows, scheduledFailed: scheduled.failed, heldToday: toHeldToday(ended), unlinked };
}
