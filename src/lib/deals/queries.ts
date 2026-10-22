import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { CompanyScope } from "@/lib/companies/pure";
import {
  endOfDay,
  fail as failFor,
  loadRecordLabels,
  one,
  safeTerm,
  startOfDay,
  type LabelRef,
  type Rel,
} from "@/lib/records/list-helpers";
import { PAGE_SIZE, type ListQuery, type Paged } from "@/lib/records/types";
import { forecastBuckets, type ForecastBucket } from "./forecast";
import { cardValue, isRotting } from "./kanban";
import { dealStatusOf, type DealStatus } from "./schema";

const fail = (what: string, error: { message: string; code?: string }) => failFor("deals", what, error);

export const DEAL_SORTS = ["title", "contract_value", "expected_close_date", "stage_entered_at", "created_at"];
export const BOARD_STAGE_LIMIT = 500;
const FORECAST_LIMIT = 5000;

/** Filtros da lista além dos comuns: funil, etapas, equipes e esfriando. */
export type DealListQuery = ListQuery & {
  pipeline?: string | null;
  stage?: string[];
  team?: string[];
  rotting?: boolean;
};

/** Filtros do quadro e da previsão. */
export type DealBoardFilters = { q?: string; owner?: string[]; team?: string[]; label?: string[]; rotting?: boolean };

export type DealRow = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  title: string;
  status: DealStatus;
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  probability: number;
  rotting: boolean;
  person: { id: string; name: string } | null;
  organization: { id: string; name: string } | null;
  estimatedValue: number | null;
  contractValue: number;
  mrr: number;
  setupTotal: number;
  /** Valor exibido: total do contrato ou, sem contrato, o estimado. */
  totalValue: number;
  expectedCloseDate: string | null;
  stageEnteredAt: string;
  ownerId: string;
  ownerName: string;
  labels: LabelRef[];
  createdAt: string;
};

const LIST_SELECT =
  "id, company_id, title, status, pipeline_id, stage_id, estimated_value, contract_value, mrr, setup_total, expected_close_date, stage_entered_at, owner_id, created_at, company:companies(name, slug), owner:profiles!owner_id(full_name), person:persons(id, full_name, deleted_at), organization:organizations(id, name, deleted_at), stage:stages(name, probability, rotting_days), pipeline:pipelines(name)";

type RawRow = {
  id: string;
  company_id: string;
  title: string;
  status: DealStatus;
  pipeline_id: string;
  stage_id: string;
  estimated_value: number | string | null;
  contract_value: number | string;
  mrr: number | string;
  setup_total: number | string;
  expected_close_date: string | null;
  stage_entered_at: string;
  owner_id: string;
  created_at: string;
  company: Rel<{ name: string; slug: string }>;
  owner: Rel<{ full_name: string; avatar_url?: string | null }>;
  person: Rel<{ id: string; full_name: string; deleted_at: string | null }>;
  organization: Rel<{ id: string; name: string; deleted_at: string | null }>;
  stage: Rel<{ name: string; probability: number; rotting_days: number | null }>;
  pipeline: Rel<{ name: string }>;
};

const num = (v: number | string) => Number(v);

function toRow(r: RawRow, labels: Map<string, LabelRef[]>, now: Date): DealRow {
  const person = one(r.person);
  const org = one(r.organization);
  const stage = one(r.stage);
  const estimated = r.estimated_value === null ? null : num(r.estimated_value);
  const money = { contractValue: num(r.contract_value), estimatedValue: estimated, mrr: num(r.mrr), setupTotal: num(r.setup_total) };
  return {
    id: r.id,
    companyId: r.company_id,
    companySlug: one(r.company)?.slug ?? "",
    companyName: one(r.company)?.name ?? "",
    title: r.title,
    status: r.status,
    pipelineId: r.pipeline_id,
    pipelineName: one(r.pipeline)?.name ?? "",
    stageId: r.stage_id,
    stageName: stage?.name ?? "",
    probability: stage?.probability ?? 0,
    rotting: isRotting({ status: r.status, stageEnteredAt: r.stage_entered_at }, { rottingDays: stage?.rotting_days ?? null }, now),
    person: person && !person.deleted_at ? { id: person.id, name: person.full_name } : null,
    organization: org && !org.deleted_at ? { id: org.id, name: org.name } : null,
    ...money,
    totalValue: cardValue(money, "total"),
    expectedCloseDate: r.expected_close_date,
    stageEnteredAt: r.stage_entered_at,
    ownerId: r.owner_id,
    ownerName: one(r.owner)?.full_name ?? "",
    labels: labels.get(r.id) ?? [],
    createdAt: r.created_at,
  };
}

/** Filtros comuns que dependem de leituras prévias (equipes, etapas que esfriam). */
type Resolved = { teamOwners: string[] | null; rottingOr: string | null };

async function resolveCommon(
  f: { team?: string[]; rotting?: boolean },
  stageScope: { companyId?: string; pipelineId?: string | null; stageIds?: string[] },
): Promise<Resolved | null> {
  const supabase = await createServerClient();
  let teamOwners: string[] | null = null;
  if (f.team && f.team.length > 0) {
    const { data, error } = await supabase.from("team_members").select("user_id").in("team_id", f.team);
    if (error) fail("equipes", error);
    teamOwners = [...new Set((data ?? []).map((m) => m.user_id as string))];
    if (teamOwners.length === 0) return null;
  }
  let rottingOr: string | null = null;
  if (f.rotting) {
    let sq = supabase.from("stages").select("id, rotting_days").not("rotting_days", "is", null).is("archived_at", null);
    if (stageScope.companyId) sq = sq.eq("company_id", stageScope.companyId);
    if (stageScope.pipelineId) sq = sq.eq("pipeline_id", stageScope.pipelineId);
    if (stageScope.stageIds && stageScope.stageIds.length > 0) sq = sq.in("id", stageScope.stageIds);
    const { data, error } = await sq;
    if (error) fail("etapas", error);
    const now = Date.now();
    const parts = (data ?? []).map(
      (s) => `and(stage_id.eq.${s.id},stage_entered_at.lt.${new Date(now - s.rotting_days * 86_400_000).toISOString()})`,
    );
    if (parts.length === 0) return null;
    rottingOr = parts.join(",");
  }
  return { teamOwners, rottingOr };
}

type Filterable<T> = {
  in(c: string, v: string[]): T;
  eq(c: string, v: string): T;
  or(f: string): T;
  ilike(c: string, p: string): T;
};

function applyCommon<T extends Filterable<T>>(
  q: T,
  f: { q?: string; owner?: string[] },
  r: Resolved,
): T {
  if (f.owner && f.owner.length > 0) q = q.in("owner_id", f.owner);
  if (r.teamOwners) q = q.in("owner_id", r.teamOwners);
  if (r.rottingOr) q = q.eq("status", "open").or(r.rottingOr);
  const term = safeTerm(f.q ?? "");
  if (term) q = q.ilike("title", `%${term}%`);
  return q;
}

/** `deals` ou o filtro por etiqueta (todas as etiquetas escolhidas; o RLS continua valendo). */
async function dealsSource(label: string[] | undefined) {
  const supabase = await createServerClient();
  return (label && label.length > 0
    ? supabase.rpc("deals_with_labels", { p_label_ids: label }, { count: "exact" })
    : supabase.from("deals")) as unknown as ReturnType<typeof supabase.from>;
}

export async function fetchDealRows(
  scope: CompanyScope,
  query: DealListQuery,
  range: { from: number; to: number },
  companyIds?: string[],
): Promise<{ rows: DealRow[]; total: number }> {
  const resolved = await resolveCommon(query, {
    companyId: scope.kind === "company" ? scope.company.id : undefined,
    pipelineId: query.pipeline,
    stageIds: query.stage,
  });
  if (!resolved) return { rows: [], total: 0 };

  let q = (await dealsSource(query.label))
    .select(LIST_SELECT, { count: "exact" })
    .is("deleted_at", null);
  if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
  if (companyIds) q = q.in("company_id", companyIds);
  if (query.pipeline) q = q.eq("pipeline_id", query.pipeline);
  if (query.stage && query.stage.length > 0) q = q.in("stage_id", query.stage);
  q = q.eq("status", dealStatusOf(query));
  q = applyCommon(q, query, resolved);
  if (query.createdFrom) q = q.gte("created_at", startOfDay(query.createdFrom));
  if (query.createdTo) q = q.lte("created_at", endOfDay(query.createdTo));
  const sort = DEAL_SORTS.includes(query.sort) ? query.sort : "created_at";
  q = q.order(sort, { ascending: query.dir === "asc", nullsFirst: false }).order("id");
  const { data, count, error } = await q.range(range.from, range.to);
  if (error?.code === "PGRST103") return { rows: [], total: 0 };
  if (error) fail("lista", error);

  const raw = (data ?? []) as unknown as RawRow[];
  const labelsBy = await loadRecordLabels("deals", raw.map((r) => r.id));
  const now = new Date();
  return { rows: raw.map((r) => toRow(r, labelsBy, now)), total: count ?? 0 };
}

export async function listDeals(scope: CompanyScope, query: DealListQuery): Promise<Paged<DealRow>> {
  const from = (query.page - 1) * PAGE_SIZE;
  const { rows, total } = await fetchDealRows(scope, query, { from, to: from + PAGE_SIZE - 1 });
  return { rows, total, page: query.page, pageSize: PAGE_SIZE };
}

// Quadro -------------------------------------------------------------------------------------------

export type BoardStage = {
  id: string;
  name: string;
  probability: number;
  rottingDays: number | null;
  requiredFields: string[];
  /** Total de negócios abertos na etapa (pode passar de `deals.length`). */
  count: number;
  truncated: boolean;
  deals: BoardDeal[];
};

export type BoardDeal = DealRow & { position: number; ownerAvatarUrl: string | null };

export type Board = {
  pipeline: { id: string; name: string; cardValueField: "total" | "mrr" | "setup"; archived: boolean };
  stages: BoardStage[];
};

const BOARD_SELECT = `${LIST_SELECT}, position`.replace(
  "owner:profiles!owner_id(full_name)",
  "owner:profiles!owner_id(full_name, avatar_url)",
);

type BoardRaw = RawRow & { position: number | string };

/** Etapas não arquivadas e negócios abertos do funil; até 500 por etapa (`truncated` avisa). */
export async function getBoard(
  companyId: string,
  pipelineId: string,
  filters: DealBoardFilters = {},
): Promise<Board | null> {
  const supabase = await createServerClient();
  const { data: p, error: pe } = await supabase
    .from("pipelines")
    .select("id, name, card_value_field, archived_at, stages(id, name, position, probability, rotting_days, required_fields, archived_at)")
    .eq("id", pipelineId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (pe) fail("funil", pe);
  if (!p) return null;
  const stages = [...((p.stages ?? []) as {
    id: string; name: string; position: number; probability: number; rotting_days: number | null;
    required_fields: string[]; archived_at: string | null;
  }[])]
    .filter((s) => s.archived_at === null)
    .sort((a, b) => a.position - b.position);

  const pipeline: Board["pipeline"] = {
    id: p.id,
    name: p.name,
    cardValueField: p.card_value_field as Board["pipeline"]["cardValueField"],
    archived: p.archived_at !== null,
  };
  const resolved = await resolveCommon(filters, { companyId, pipelineId });
  const labelsFilter = filters.label ?? [];
  const now = new Date();

  const columns = await Promise.all(
    stages.map(async (s): Promise<BoardStage> => {
      const base: Omit<BoardStage, "count" | "truncated" | "deals"> = {
        id: s.id,
        name: s.name,
        probability: s.probability,
        rottingDays: s.rotting_days,
        requiredFields: s.required_fields,
      };
      if (!resolved) return { ...base, count: 0, truncated: false, deals: [] };
      let q = (await dealsSource(labelsFilter))
        .select(BOARD_SELECT, { count: "exact" })
        .is("deleted_at", null)
        .eq("company_id", companyId)
        .eq("pipeline_id", pipelineId)
        .eq("stage_id", s.id)
        .eq("status", "open");
      q = applyCommon(q, filters, resolved);
      const { data, count, error } = await q.order("position").order("id").range(0, BOARD_STAGE_LIMIT - 1);
      if (error) fail("quadro", error);
      const raw = (data ?? []) as unknown as BoardRaw[];
      const labelsBy = await loadRecordLabels("deals", raw.map((r) => r.id));
      const deals = raw.map((r) => ({
        ...toRow(r, labelsBy, now),
        position: num(r.position),
        ownerAvatarUrl: one(r.owner)?.avatar_url ?? null,
      }));
      const total = count ?? deals.length;
      return { ...base, count: total, truncated: total > deals.length, deals };
    }),
  );
  return { pipeline, stages: columns };
}

// Detalhe ------------------------------------------------------------------------------------------

export type DealLink =
  | { state: "ok"; id: string; name: string }
  | { state: "no_access" }
  | { state: "trashed"; name: string };

export type DealItemRow = {
  id: string;
  productId: string;
  productName: string;
  productActive: boolean;
  kind: "setup" | "recurring";
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
};

export type DealDetail = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  title: string;
  status: DealStatus;
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  /** Etapas do funil na ordem (inclui arquivadas para o histórico; quem monta a tela filtra). */
  stages: { id: string; name: string; probability: number; archived: boolean; requiredFields: string[] }[];
  lostReasonId: string | null;
  lostReasonName: string | null;
  lostNote: string | null;
  leadId: string | null;
  personId: string | null;
  person: DealLink | null;
  organizationId: string | null;
  organization: DealLink | null;
  estimatedValue: number | null;
  expectedCloseDate: string | null;
  stageEnteredAt: string;
  wonAt: string | null;
  lostAt: string | null;
  setupTotal: number;
  setupInstallments: number;
  /** "YYYY-MM" */
  setupFirstDue: string | null;
  mrr: number;
  /** "YYYY-MM" */
  mrrStart: string | null;
  contractMonths: number | null;
  contractValue: number;
  items: DealItemRow[];
  schedule: { month: string; setup: number; mrr: number }[];
  ownerId: string;
  customFields: Record<string, unknown>;
  createdAt: string;
  labelIds: string[];
};

async function resolveLink(
  table: "persons" | "organizations",
  id: string | null,
  nameCol: "full_name" | "name",
): Promise<DealLink | null> {
  if (!id) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase.from(table).select(`id, ${nameCol}, deleted_at`).eq("id", id).maybeSingle();
  if (error) fail(table === "persons" ? "pessoa vinculada" : "organização vinculada", error);
  if (!data) return { state: "no_access" };
  const row = data as unknown as Record<string, string | null>;
  const name = String(row[nameCol] ?? "");
  return row.deleted_at ? { state: "trashed", name } : { state: "ok", id, name };
}

export async function getDeal(id: string): Promise<DealDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("deals")
    .select(
      "id, company_id, title, status, pipeline_id, stage_id, lost_reason_id, lost_note, lead_id, person_id, organization_id, estimated_value, expected_close_date, stage_entered_at, won_at, lost_at, setup_total, setup_installments, setup_first_due, mrr, mrr_start, contract_months, contract_value, owner_id, custom_fields, created_at, company:companies(name, slug), pipeline:pipelines(name, stages(id, name, position, probability, required_fields, archived_at)), reason:lost_reasons(name)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail("detalhe", error);
  if (!data) return null;
  const [labels, items, schedule, person, organization] = await Promise.all([
    supabase.from("record_labels").select("label_id").eq("entity", "deals").eq("record_id", id),
    supabase
      .from("deal_items")
      .select("id, product_id, kind, quantity, unit_price, discount, total, position, product:products(name, active)")
      .eq("deal_id", id)
      .order("position")
      .order("created_at"),
    supabase.from("deal_revenue_schedule").select("month, setup, mrr").eq("deal_id", id).order("month"),
    resolveLink("persons", data.person_id, "full_name"),
    resolveLink("organizations", data.organization_id, "name"),
  ]);
  if (labels.error) fail("etiquetas do detalhe", labels.error);
  if (items.error) fail("itens", items.error);
  if (schedule.error) fail("cronograma", schedule.error);
  const company = one(data.company as Rel<{ name: string; slug: string }>);
  const pipeline = one(
    data.pipeline as Rel<{
      name: string;
      stages: { id: string; name: string; position: number; probability: number; required_fields: string[]; archived_at: string | null }[];
    }>,
  );
  const month = (d: string | null) => (d ? d.slice(0, 7) : null);
  return {
    id: data.id,
    companyId: data.company_id,
    companySlug: company?.slug ?? "",
    companyName: company?.name ?? "",
    title: data.title,
    status: data.status as DealStatus,
    pipelineId: data.pipeline_id,
    pipelineName: pipeline?.name ?? "",
    stageId: data.stage_id,
    stages: [...(pipeline?.stages ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        id: s.id,
        name: s.name,
        probability: s.probability,
        archived: s.archived_at !== null,
        requiredFields: s.required_fields,
      })),
    lostReasonId: data.lost_reason_id,
    lostReasonName: one(data.reason as Rel<{ name: string }>)?.name ?? null,
    lostNote: data.lost_note,
    leadId: data.lead_id,
    personId: data.person_id,
    person,
    organizationId: data.organization_id,
    organization,
    estimatedValue: data.estimated_value === null ? null : num(data.estimated_value),
    expectedCloseDate: data.expected_close_date,
    stageEnteredAt: data.stage_entered_at,
    wonAt: data.won_at,
    lostAt: data.lost_at,
    setupTotal: num(data.setup_total),
    setupInstallments: data.setup_installments,
    setupFirstDue: month(data.setup_first_due),
    mrr: num(data.mrr),
    mrrStart: month(data.mrr_start),
    contractMonths: data.contract_months,
    contractValue: num(data.contract_value),
    items: (items.data ?? []).map((i) => {
      const product = one(i.product as Rel<{ name: string; active: boolean }>);
      return {
        id: i.id,
        productId: i.product_id,
        productName: product?.name ?? "",
        productActive: product?.active ?? true,
        kind: i.kind as "setup" | "recurring",
        quantity: num(i.quantity),
        unitPrice: num(i.unit_price),
        discount: num(i.discount),
        total: num(i.total),
      };
    }),
    schedule: (schedule.data ?? []).map((s) => ({ month: s.month.slice(0, 7), setup: num(s.setup), mrr: num(s.mrr) })),
    ownerId: data.owner_id,
    customFields: (data.custom_fields ?? {}) as Record<string, unknown>,
    createdAt: data.created_at,
    labelIds: (labels.data ?? []).map((l) => l.label_id as string),
  };
}

// Previsão -----------------------------------------------------------------------------------------

export type ForecastRow = {
  id: string;
  title: string;
  status: string;
  expectedCloseDate: string | null;
  /** Valor total (contrato ou estimado). */
  value: number;
  probability: number;
  stageName: string;
  ownerName: string;
  organizationName: string | null;
};

/** Negócios abertos do funil agrupados por mês previsto de fechamento. */
export async function getForecast(
  companyId: string,
  pipelineId: string,
  filters: DealBoardFilters = {},
  now: Date = new Date(),
): Promise<ForecastBucket<ForecastRow>[]> {
  const resolved = await resolveCommon(filters, { companyId, pipelineId });
  if (!resolved) return forecastBuckets<ForecastRow>([], now);
  let q = (await dealsSource(filters.label))
    .select(
      "id, title, status, estimated_value, contract_value, expected_close_date, owner:profiles!owner_id(full_name), organization:organizations(name, deleted_at), stage:stages(name, probability)",
    )
    .is("deleted_at", null)
    .eq("company_id", companyId)
    .eq("pipeline_id", pipelineId)
    .eq("status", "open");
  q = applyCommon(q, filters, resolved);
  const { data, error } = await q.order("expected_close_date", { nullsFirst: false }).order("id").range(0, FORECAST_LIMIT - 1);
  if (error) fail("previsão", error);
  const rows = ((data ?? []) as unknown as {
    id: string; title: string; status: string; estimated_value: number | string | null;
    contract_value: number | string; expected_close_date: string | null;
    owner: Rel<{ full_name: string }>;
    organization: Rel<{ name: string; deleted_at: string | null }>;
    stage: Rel<{ name: string; probability: number }>;
  }[]).map((r): ForecastRow => {
    const org = one(r.organization);
    const stage = one(r.stage);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      expectedCloseDate: r.expected_close_date,
      value: cardValue(
        { contractValue: num(r.contract_value), estimatedValue: r.estimated_value === null ? null : num(r.estimated_value), mrr: 0, setupTotal: 0 },
        "total",
      ),
      probability: stage?.probability ?? 0,
      stageName: stage?.name ?? "",
      ownerName: one(r.owner)?.full_name ?? "",
      organizationName: org && !org.deleted_at ? org.name : null,
    };
  });
  return forecastBuckets(rows, now);
}

// Motivos de perda ---------------------------------------------------------------------------------

/** Motivos ativos da empresa, na ordem configurada (formulário de perda). */
export async function listActiveLostReasons(companyId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("lost_reasons")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("position")
    .order("name");
  if (error) fail("motivos de perda", error);
  return data ?? [];
}
