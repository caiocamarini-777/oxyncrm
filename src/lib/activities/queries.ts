import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { one, safeTerm, type Rel } from "@/lib/records/list-helpers";
import { PAGE_SIZE, type ListQuery, type Paged, type RecordEntity } from "@/lib/records/types";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import type { MeetingOutcome } from "./schema";
import { dayKey, dueStatus, startOfDayUtc, startOfNextDayUtc, type DueStatus } from "./time";

function fail(what: string, error: { message: string; code?: string }): never {
  console.error(`[atividades] ${what}:`, error.code, error.message);
  throw new Error(`Falha ao carregar atividades (${what}).`);
}

export const ACTIVITY_TABS = ["overdue", "today", "upcoming", "done"] as const;
export type ActivityTab = (typeof ACTIVITY_TABS)[number];

/** Filtros além dos comuns da lista: aba, tipos, canais e equipes. */
export type ActivityListQuery = ListQuery & {
  tab: ActivityTab;
  type: string[];
  channel: string[];
  team: string[];
};

export type AgendaFilters = { owner?: string[]; type?: string[]; channel?: string[]; team?: string[]; q?: string };

export type ActivityLink = { id: string; name: string };

export type ActivityRow = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  type: { id: string; name: string; isMeeting: boolean };
  channel: { id: string; name: string };
  subject: string;
  description: string | null;
  dueAt: string;
  durationMinutes: number;
  reminderMinutes: number | null;
  done: boolean;
  completedAt: string | null;
  outcome: { name: string; classification: "success" | "neutral" | "failure" } | null;
  meetingOutcome: MeetingOutcome | null;
  completionNote: string | null;
  ownerId: string;
  ownerName: string;
  /** Só os vínculos que o usuário consegue ler e que não estão na lixeira. */
  lead: ActivityLink | null;
  deal: ActivityLink | null;
  person: ActivityLink | null;
  organization: ActivityLink | null;
  bookedByActivityId: string | null;
  legacy: boolean;
  status: DueStatus;
};

const SELECT =
  "id, company_id, subject, description, due_at, duration_minutes, reminder_minutes, done, completed_at, meeting_outcome, completion_note, owner_id, booked_by_activity_id, legacy, " +
  "company:companies(name, slug), type:activity_types(id, name, is_meeting), channel:activity_channels!channel_id(id, name), " +
  "outcome:activity_outcomes(name, classification), owner:profiles!owner_id(full_name), " +
  "lead:leads(id, title, deleted_at), deal:deals(id, title, deleted_at), person:persons(id, full_name, deleted_at), organization:organizations(id, name, deleted_at)";

type RawRow = {
  id: string;
  company_id: string;
  subject: string;
  description: string | null;
  due_at: string;
  duration_minutes: number;
  reminder_minutes: number | null;
  done: boolean;
  completed_at: string | null;
  meeting_outcome: MeetingOutcome | null;
  completion_note: string | null;
  owner_id: string;
  booked_by_activity_id: string | null;
  legacy: boolean;
  company: Rel<{ name: string; slug: string }>;
  type: Rel<{ id: string; name: string; is_meeting: boolean }>;
  channel: Rel<{ id: string; name: string }>;
  outcome: Rel<{ name: string; classification: "success" | "neutral" | "failure" }>;
  owner: Rel<{ full_name: string }>;
  lead: Rel<{ id: string; title: string; deleted_at: string | null }>;
  deal: Rel<{ id: string; title: string; deleted_at: string | null }>;
  person: Rel<{ id: string; full_name: string; deleted_at: string | null }>;
  organization: Rel<{ id: string; name: string; deleted_at: string | null }>;
};

function link<T extends { id: string; deleted_at: string | null }>(
  v: Rel<T>,
  name: (x: T) => string,
): ActivityLink | null {
  const x = one(v);
  return x && !x.deleted_at ? { id: x.id, name: name(x) } : null;
}

export function toActivityRow(r: RawRow, now: Date): ActivityRow {
  const type = one(r.type);
  const channel = one(r.channel);
  const outcome = one(r.outcome);
  return {
    id: r.id,
    companyId: r.company_id,
    companySlug: one(r.company)?.slug ?? "",
    companyName: one(r.company)?.name ?? "",
    type: { id: type?.id ?? "", name: type?.name ?? "", isMeeting: type?.is_meeting ?? false },
    channel: { id: channel?.id ?? "", name: channel?.name ?? "" },
    subject: r.subject,
    description: r.description,
    dueAt: r.due_at,
    durationMinutes: r.duration_minutes,
    reminderMinutes: r.reminder_minutes,
    done: r.done,
    completedAt: r.completed_at,
    outcome: outcome ? { name: outcome.name, classification: outcome.classification } : null,
    meetingOutcome: r.meeting_outcome,
    completionNote: r.completion_note,
    ownerId: r.owner_id,
    ownerName: one(r.owner)?.full_name ?? "",
    lead: link(r.lead, (x) => x.title),
    deal: link(r.deal, (x) => x.title),
    person: link(r.person, (x) => x.full_name),
    organization: link(r.organization, (x) => x.name),
    bookedByActivityId: r.booked_by_activity_id,
    legacy: r.legacy,
    status: dueStatus(r.due_at, r.done, now),
  };
}

/** Donos das equipes escolhidas; `null` = nenhuma equipe tem membros (resultado vazio). */
async function teamOwners(team: string[] | undefined): Promise<string[] | undefined | null> {
  if (!team || team.length === 0) return undefined;
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("team_members").select("user_id").in("team_id", team);
  if (error) fail("equipes", error);
  const ids = [...new Set((data ?? []).map((m) => m.user_id as string))];
  return ids.length > 0 ? ids : null;
}

type Filters = { owner?: string[]; type?: string[]; channel?: string[]; q?: string };

function applyFilters<Q extends { in: (c: string, v: string[]) => Q; ilike: (c: string, p: string) => Q }>(
  q: Q,
  f: Filters,
  owners: string[] | undefined,
): Q {
  if (f.owner && f.owner.length > 0) q = q.in("owner_id", f.owner);
  if (owners) q = q.in("owner_id", owners);
  if (f.type && f.type.length > 0) q = q.in("type_id", f.type.filter(isUuid));
  if (f.channel && f.channel.length > 0) q = q.in("channel_id", f.channel.filter(isUuid));
  const term = safeTerm(f.q ?? "");
  if (term) q = q.ilike("subject", `%${term}%`);
  return q;
}

export const ACTIVITY_SORTS = ["due_at", "subject", "created_at", "completed_at"];

/** Lista por aba (atrasadas, hoje, próximas, concluídas), com os dias em São Paulo. */
export async function listActivities(
  scope: CompanyScope,
  query: ActivityListQuery,
  now: Date = new Date(),
): Promise<Paged<ActivityRow>> {
  const empty = { rows: [], total: 0, page: query.page, pageSize: PAGE_SIZE } as const;
  const owners = await teamOwners(query.team);
  if (owners === null) return { ...empty, rows: [] };
  const supabase = await createServerClient();
  let q = supabase.from("activities").select(SELECT, { count: "exact" }).is("deleted_at", null);
  if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
  q = applyFilters(q, query, owners);

  const nowIso = now.toISOString();
  const tomorrow = startOfNextDayUtc(dayKey(now));
  switch (query.tab) {
    case "overdue":
      q = q.eq("done", false).lt("due_at", nowIso);
      break;
    case "today":
      q = q.eq("done", false).gte("due_at", nowIso).lt("due_at", tomorrow);
      break;
    case "upcoming":
      q = q.eq("done", false).gte("due_at", tomorrow);
      break;
    case "done":
      q = q.eq("done", true);
      break;
  }
  const done = query.tab === "done";
  const defaultSort = done ? "completed_at" : "due_at";
  const sort = ACTIVITY_SORTS.includes(query.sort) && query.sort !== "created_at" ? query.sort : defaultSort;
  const asc = query.sort === sort ? query.dir === "asc" : !done;
  q = q.order(sort, { ascending: asc, nullsFirst: false }).order("id");
  const from = (query.page - 1) * PAGE_SIZE;
  const { data, count, error } = await q.range(from, from + PAGE_SIZE - 1);
  if (error?.code === "PGRST103") return { ...empty, rows: [] };
  if (error) fail("lista", error);
  const rows = ((data ?? []) as unknown as RawRow[]).map((r) => toActivityRow(r, now));
  return { rows, total: count ?? 0, page: query.page, pageSize: PAGE_SIZE };
}

const AGENDA_LIMIT = 2000;

/** Atividades (abertas e concluídas) entre dois dias de São Paulo, `from` e `to` inclusive. */
export async function getAgenda(
  scope: CompanyScope,
  from: string,
  to: string,
  filters: AgendaFilters & { team?: string[] } = {},
  now: Date = new Date(),
): Promise<ActivityRow[]> {
  const owners = await teamOwners(filters.team);
  if (owners === null) return [];
  const supabase = await createServerClient();
  let q = supabase
    .from("activities")
    .select(SELECT)
    .is("deleted_at", null)
    .gte("due_at", startOfDayUtc(from))
    .lt("due_at", startOfNextDayUtc(to));
  if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
  q = applyFilters(q, filters, owners);
  const { data, error } = await q.order("due_at").order("id").limit(AGENDA_LIMIT);
  if (error) fail("agenda", error);
  return ((data ?? []) as unknown as RawRow[]).map((r) => toActivityRow(r, now));
}

const LINK_COLUMN: Record<RecordEntity, string> = {
  leads: "lead_id",
  deals: "deal_id",
  persons: "person_id",
  organizations: "organization_id",
};

/** Atividades do registro: abertas (mais próximas primeiro) e concluídas (mais recentes primeiro). */
export async function getActivitiesFor(
  entity: RecordEntity,
  id: string,
  now: Date = new Date(),
): Promise<{ open: ActivityRow[]; done: ActivityRow[] }> {
  if (!isUuid(id)) return { open: [], done: [] };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("activities")
    .select(SELECT)
    .eq(LINK_COLUMN[entity], id)
    .is("deleted_at", null)
    .order("due_at")
    .order("id")
    .limit(500);
  if (error) fail("do registro", error);
  const rows = ((data ?? []) as unknown as RawRow[]).map((r) => toActivityRow(r, now));
  return {
    open: rows.filter((r) => !r.done),
    done: rows
      .filter((r) => r.done)
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
  };
}

export type NextActivity = { activityId: string; dueAt: string; subject: string; overdue: boolean };

/** Próxima atividade aberta por lead/negócio (RPC `next_activity_for`, respeita o RLS). */
export async function nextActivitiesFor(
  entity: "leads" | "deals",
  ids: string[],
): Promise<Map<string, NextActivity>> {
  const out = new Map<string, NextActivity>();
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return out;
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("next_activity_for", { p_entity: entity, p_ids: valid });
  if (error) fail("próximas atividades", error);
  for (const r of (data ?? []) as {
    record_id: string;
    activity_id: string;
    due_at: string;
    subject: string;
    overdue: boolean;
  }[]) {
    out.set(r.record_id, { activityId: r.activity_id, dueAt: r.due_at, subject: r.subject, overdue: r.overdue });
  }
  return out;
}

export type ActivityCatalogItem = { id: string; name: string; active: boolean };
export type ActivityCatalog = {
  types: (ActivityCatalogItem & { isMeeting: boolean })[];
  channels: (ActivityCatalogItem & { isLegacy: boolean })[];
  outcomes: (ActivityCatalogItem & { classification: "success" | "neutral" | "failure"; booksMeeting: boolean })[];
};

/** Tipos, canais e resultados da empresa (inclui inativos; quem monta o formulário filtra). */
export async function getActivityCatalog(companyId: string): Promise<ActivityCatalog> {
  const supabase = await createServerClient();
  const [types, channels, outcomes] = await Promise.all([
    supabase.from("activity_types").select("id, name, is_meeting, active").eq("company_id", companyId).order("position").order("name"),
    supabase.from("activity_channels").select("id, name, is_legacy, active").eq("company_id", companyId).order("position").order("name"),
    supabase
      .from("activity_outcomes")
      .select("id, name, classification, books_meeting, active")
      .eq("company_id", companyId)
      .order("position")
      .order("name"),
  ]);
  if (types.error) fail("tipos", types.error);
  if (channels.error) fail("canais", channels.error);
  if (outcomes.error) fail("resultados", outcomes.error);
  return {
    types: (types.data ?? []).map((t) => ({ id: t.id, name: t.name, active: t.active, isMeeting: t.is_meeting })),
    channels: (channels.data ?? []).map((c) => ({ id: c.id, name: c.name, active: c.active, isLegacy: c.is_legacy })),
    outcomes: (outcomes.data ?? []).map((o) => ({
      id: o.id,
      name: o.name,
      active: o.active,
      classification: o.classification,
      booksMeeting: o.books_meeting,
    })),
  };
}
