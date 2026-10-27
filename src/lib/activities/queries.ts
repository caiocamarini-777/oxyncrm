import "server-only";
import { cache } from "react";
import type { CompanyScope } from "@/lib/companies/pure";
import { safeTerm } from "@/lib/records/list-helpers";
import { PAGE_SIZE, type ListQuery, type Paged, type RecordEntity } from "@/lib/records/types";
import { createServerClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/uuid";
import { toActivityRow, SELECT, type ActivityRow, type RawRow } from "./rows";
import { dayKey, startOfDayUtc, startOfNextDayUtc } from "./time";

export type { ActivityRow, ActivityLink } from "./rows";

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

/** Donos das equipes escolhidas; `null` = nenhuma equipe tem membros (resultado vazio). */
const teamOwnersByKey = cache(async (key: string): Promise<string[] | null> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("team_members").select("user_id").in("team_id", key.split(","));
  if (error) fail("equipes", error);
  const owners = [...new Set((data ?? []).map((m) => m.user_id as string))];
  return owners.length > 0 ? owners : null;
});

/** Donos das equipes escolhidas (uma consulta por requisição); `null` = nenhuma equipe tem membros. */
async function teamOwners(team: string[] | undefined): Promise<string[] | undefined | null> {
  const ids = [...new Set((team ?? []).filter(isUuid))].sort();
  if (ids.length === 0) return undefined;
  return teamOwnersByKey(ids.join(","));
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

/** Quantas atividades abertas estão atrasadas, com os mesmos filtros da lista (contador da aba). */
export async function countOverdue(
  scope: CompanyScope,
  query: Omit<ActivityListQuery, "tab">,
  now: Date = new Date(),
): Promise<number> {
  const owners = await teamOwners(query.team);
  if (owners === null) return 0;
  const supabase = await createServerClient();
  let q = supabase.from("activities").select("id", { count: "exact", head: true }).is("deleted_at", null);
  if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
  q = applyFilters(q, query, owners).eq("done", false).lt("due_at", now.toISOString());
  const { count, error } = await q;
  if (error) fail("contagem de atrasadas", error);
  return count ?? 0;
}

export const AGENDA_LIMIT = 2000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Atividades (abertas e concluídas) entre dois dias de São Paulo, `from` e `to` inclusive. */
export async function getAgenda(
  scope: CompanyScope,
  from: string,
  to: string,
  filters: AgendaFilters & { team?: string[] } = {},
  now: Date = new Date(),
): Promise<ActivityRow[]> {
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return [];
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

const RECORD_LIMIT = 200;

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
  const base = () => supabase.from("activities").select(SELECT).eq(LINK_COLUMN[entity], id).is("deleted_at", null);
  const [open, done] = await Promise.all([
    base().eq("done", false).order("due_at").order("id").limit(RECORD_LIMIT),
    base().eq("done", true).order("completed_at", { ascending: false }).order("id").limit(RECORD_LIMIT),
  ]);
  if (open.error) fail("abertas do registro", open.error);
  if (done.error) fail("concluídas do registro", done.error);
  const toRows = (d: unknown) => ((d ?? []) as RawRow[]).map((r) => toActivityRow(r, now));
  return { open: toRows(open.data), done: toRows(done.data) };
}

export type ActivityCatalogItem = { id: string; name: string; active: boolean };
export type ActivityCatalog = {
  types: (ActivityCatalogItem & { isMeeting: boolean })[];
  channels: (ActivityCatalogItem & { isLegacy: boolean })[];
  outcomes: (ActivityCatalogItem & {
    classification: "success" | "neutral" | "failure";
    booksMeeting: boolean;
    /** "activity": resultado de tentativa; "meeting": qualificação da reunião realizada. */
    appliesTo: "activity" | "meeting";
  })[];
};

/** Tipos, canais e resultados da empresa (inclui inativos; quem monta o formulário filtra). */
export async function getActivityCatalog(companyId: string): Promise<ActivityCatalog> {
  const supabase = await createServerClient();
  const [types, channels, outcomes] = await Promise.all([
    supabase.from("activity_types").select("id, name, is_meeting, active").eq("company_id", companyId).order("position").order("name"),
    supabase.from("activity_channels").select("id, name, is_legacy, active").eq("company_id", companyId).order("position").order("name"),
    supabase
      .from("activity_outcomes")
      .select("id, name, classification, books_meeting, active, applies_to")
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
      appliesTo: o.applies_to === "meeting" ? "meeting" : "activity",
    })),
  };
}
