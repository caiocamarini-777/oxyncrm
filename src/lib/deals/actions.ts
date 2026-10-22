"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import { translateDbError } from "@/lib/db-errors";
import { checkCustomFields, firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { parseMissingFields } from "./required";
import {
  contractDatesNeeded,
  contractSchema,
  dateToMonth,
  dealItemSchema,
  dealItemUpdateSchema,
  dealSchema,
  lostSchema,
  monthToDate,
  MSG_MRR_DATES,
  MSG_SETUP_DATE,
  type ContractInput,
  type DealInput,
  type DealItemInput,
  type DealItemUpdateInput,
  type LostInput,
} from "./schema";

const uuid = z.string().uuid();
const NO_PERMISSION = "Você não tem permissão para esta ação.";
const INVALID = { ok: false, error: "Dados inválidos." } as const;
const SAVE_FAILED = "Não foi possível concluir. Tente novamente.";

/** Falha com a lista de campos obrigatórios da etapa (chaves como em `required.ts`), quando houver. */
export type DealFailure = { ok: false; error: string; fieldErrors?: Record<string, string>; missing?: string[] };
export type DealResult<T = void> = { ok: true; data: T } | DealFailure;

function dbFailure(error: { code?: string; message?: string; details?: string | null }): DealFailure {
  const f: DealFailure = { ok: false, error: translateDbError(error) };
  if (error.message?.includes("OXYN_REQUIRED_FIELDS")) f.missing = parseMissingFields(error.details ?? "");
  return f;
}

const touched = () => revalidatePath("/", "layout");

/** Cria o negócio no fim da etapa escolhida (funil e etapa vêm no input). */
export async function createDeal(companyId: string, input: DealInput): Promise<DealResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "title");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  if (!d.pipelineId) return { ok: false, error: "Escolha o funil.", fieldErrors: { pipelineId: "Escolha o funil." } };
  if (!d.stageId) return { ok: false, error: "Escolha a etapa.", fieldErrors: { stageId: "Escolha a etapa." } };
  for (const k of Object.keys(d.customFields)) if (d.customFields[k] === null) delete d.customFields[k];
  const cf = await checkCustomFields(companyId, "deals", d.customFields);
  if (!cf.ok) return { ok: false, error: cf.error, fieldErrors: { [`cf-${cf.key}`]: cf.error } };

  const supabase = await createServerClient();
  const last = await supabase
    .from("deals")
    .select("position")
    .eq("stage_id", d.stageId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) return { ok: false, error: SAVE_FAILED };
  const position = last.data ? Number(last.data.position) + 1024 : 0;

  const { data, error } = await supabase
    .from("deals")
    .insert({
      company_id: companyId,
      owner_id: d.ownerId ?? profile.id,
      title: d.title,
      pipeline_id: d.pipelineId,
      stage_id: d.stageId,
      person_id: d.personId,
      organization_id: d.organizationId,
      estimated_value: d.estimatedValue,
      expected_close_date: d.expectedCloseDate,
      custom_fields: d.customFields,
      position,
    })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  touched();
  return { ok: true, data: { id: data.id } };
}

/** Edita os dados básicos; etapa, status, contrato e responsável têm ações próprias. */
export async function updateDeal(id: string, input: DealInput): Promise<DealResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "title");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const d = parsed.data;
  const supabase = await createServerClient();
  const { data: current, error: readError } = await supabase
    .from("deals")
    .select("company_id, custom_fields")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) {
    console.error("[deals] leitura antes de salvar:", readError.code, readError.message);
    return { ok: false, error: "Não foi possível salvar agora. Tente novamente." };
  }
  if (!current) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  const currentCf = (current.custom_fields ?? {}) as Record<string, unknown>;
  const cf = await checkCustomFields(current.company_id, "deals", d.customFields, currentCf);
  if (!cf.ok) return { ok: false, error: cf.error, fieldErrors: { [`cf-${cf.key}`]: cf.error } };

  const merged = { ...currentCf, ...d.customFields };
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const { data, error } = await supabase
    .from("deals")
    .update({
      title: d.title,
      person_id: d.personId,
      organization_id: d.organizationId,
      estimated_value: d.estimatedValue,
      expected_close_date: d.expectedCloseDate,
      custom_fields: merged,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível salvar: o negócio não existe, está na lixeira ou você não tem permissão." };
  }
  touched();
  return { ok: true, data: undefined };
}

/**
 * Move para a etapa/posição. Falta de campos obrigatórios da etapa de destino volta como
 * `{ ok: false, missing }` (chaves de `required.ts`) junto com o texto traduzido.
 */
export async function moveDeal(id: string, stageId: string, position: number): Promise<DealResult> {
  if (!uuid.safeParse(id).success || !uuid.safeParse(stageId).success || !Number.isFinite(position)) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const [stage, deal] = await Promise.all([
    supabase.from("stages").select("pipeline_id, company_id").eq("id", stageId).maybeSingle(),
    supabase.from("deals").select("company_id").eq("id", id).is("deleted_at", null).maybeSingle(),
  ]);
  if (stage.error || deal.error) return { ok: false, error: SAVE_FAILED };
  if (!stage.data || !deal.data || stage.data.company_id !== deal.data.company_id) {
    return { ok: false, error: "Etapa não encontrada." };
  }
  // A etapa pode ser de outro funil da mesma empresa: funil e etapa mudam juntos.
  const { data, error } = await supabase
    .from("deals")
    .update({ pipeline_id: stage.data.pipeline_id, stage_id: stageId, position })
    .eq("id", id)
    .is("deleted_at", null)
    .eq("status", "open")
    .select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) {
    return { ok: false, error: "Não foi possível mover: o negócio não está aberto ou você não tem permissão." };
  }
  touched();
  return { ok: true, data: undefined };
}

async function setStatus(
  id: string,
  from: string[],
  patch: Record<string, unknown>,
  wrongState: string,
): Promise<DealResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("deals")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .in("status", from)
    .select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: wrongState };
  touched();
  return { ok: true, data: undefined };
}

export async function markWon(id: string): Promise<DealResult> {
  return setStatus(id, ["open"], { status: "won" }, "Só negócios abertos podem ser marcados como ganhos.");
}

/** Só de `open`. O motivo precisa estar ativo e ser da empresa do negócio. */
export async function markLost(id: string, input: LostInput): Promise<DealResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const parsed = lostSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues[0].message;
    return { ok: false, error: message, fieldErrors: { reasonId: message } };
  }
  const supabase = await createServerClient();
  const deal = await supabase.from("deals").select("company_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (deal.error) return { ok: false, error: SAVE_FAILED };
  if (!deal.data) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  const reason = await supabase
    .from("lost_reasons")
    .select("id")
    .eq("id", parsed.data.reasonId)
    .eq("company_id", deal.data.company_id)
    .eq("active", true)
    .maybeSingle();
  if (reason.error) return { ok: false, error: SAVE_FAILED };
  if (!reason.data) return { ok: false, error: "Escolha um motivo.", fieldErrors: { reasonId: "Escolha um motivo." } };
  return setStatus(
    id,
    ["open"],
    { status: "lost", lost_reason_id: parsed.data.reasonId, lost_note: parsed.data.note },
    "Só negócios abertos podem ser marcados como perdidos.",
  );
}

/** De `won` ou `lost` para `open`; o banco limpa motivo e datas. */
export async function reopenDeal(id: string): Promise<DealResult> {
  return setStatus(id, ["won", "lost"], { status: "open" }, "Só negócios ganhos ou perdidos podem ser reabertos.");
}

async function itemCount(dealId: string): Promise<number | null> {
  const supabase = await createServerClient();
  const { count, error } = await supabase.from("deal_items").select("id", { count: "exact", head: true }).eq("deal_id", dealId);
  return error ? null : (count ?? 0);
}

/**
 * Condições do contrato. Com produtos no negócio, os totais vêm dos itens: só datas e parcelas
 * são gravadas (os valores enviados são ignorados).
 */
export async function updateContract(id: string, input: ContractInput): Promise<DealResult> {
  if (!uuid.safeParse(id).success) return INVALID;
  const items = await itemCount(id);
  if (items === null) return { ok: false, error: SAVE_FAILED };
  const supabase = await createServerClient();
  let effective: ContractInput = input;
  if (items > 0) {
    // Totais vêm dos itens: as datas exigidas dependem dos valores reais do negócio.
    const cur = await supabase.from("deals").select("setup_total, mrr").eq("id", id).is("deleted_at", null).maybeSingle();
    if (cur.error) return { ok: false, error: SAVE_FAILED };
    if (!cur.data) return { ok: false, error: "Registro não encontrado ou sem permissão." };
    effective = { ...input, setupTotal: Number(cur.data.setup_total), mrr: Number(cur.data.mrr) };
  }
  const parsed = contractSchema.safeParse(effective);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "setupTotal");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const c = parsed.data;
  const patch: Record<string, unknown> = {
    setup_installments: c.setupInstallments,
    setup_first_due: monthToDate(c.setupFirstDue),
    mrr_start: monthToDate(c.mrrStart),
    contract_months: c.contractMonths,
  };
  if (items === 0) {
    patch.setup_total = c.setupTotal;
    patch.mrr = c.mrr;
  }
  const { data, error } = await supabase.from("deals").update(patch).eq("id", id).is("deleted_at", null).select("id");
  if (error) {
    if (error.code === "23514") return { ok: false, error: "Não foi possível salvar as condições do contrato." };
    return dbFailure(error);
  }
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

const contractDatesSchema = z.object({
  mrrStart: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullish(),
  contractMonths: z.number().int().min(1).max(120).nullish(),
  setupFirstDue: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullish(),
});

/**
 * Inclui um produto. Se o negócio ainda não tem as datas que o tipo do produto exige (o banco
 * recusa itens sem elas), `contract` precisa trazê-las; elas são salvas antes do item.
 */
export async function addDealItem(
  dealId: string,
  input: DealItemInput,
  contract?: { mrrStart?: string | null; contractMonths?: number | null; setupFirstDue?: string | null },
): Promise<DealResult<{ id: string }>> {
  if (!uuid.safeParse(dealId).success) return INVALID;
  const parsed = dealItemSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "productId");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const dates = contractDatesSchema.safeParse(contract ?? {});
  if (!dates.success) return { ok: false, error: MSG_MRR_DATES };
  const item = parsed.data;

  const supabase = await createServerClient();
  const [deal, product] = await Promise.all([
    supabase
      .from("deals")
      .select("company_id, mrr_start, contract_months, setup_first_due")
      .eq("id", dealId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("products").select("id, kind, active, company_id").eq("id", item.productId).maybeSingle(),
  ]);
  if (deal.error || product.error) return { ok: false, error: SAVE_FAILED };
  if (!deal.data) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  if (!product.data || product.data.company_id !== deal.data.company_id) {
    return { ok: false, error: "Escolha um produto.", fieldErrors: { productId: "Escolha um produto." } };
  }
  if (!product.data.active) {
    return { ok: false, error: translateDbError({ message: "OXYN_PRODUCT_INACTIVE" }), fieldErrors: { productId: "Este produto está inativo." } };
  }
  const kind = product.data.kind as "setup" | "recurring";

  const needed = contractDatesNeeded(
    {
      mrrStart: dateToMonth(deal.data.mrr_start),
      contractMonths: deal.data.contract_months,
      setupFirstDue: dateToMonth(deal.data.setup_first_due),
    },
    kind,
  );
  if (needed === "mrr") {
    const mrrStart = dates.data.mrrStart ?? dateToMonth(deal.data.mrr_start);
    const months = dates.data.contractMonths ?? deal.data.contract_months;
    if (!mrrStart || months === null || months === undefined) {
      return { ok: false, error: MSG_MRR_DATES, fieldErrors: { mrrStart: MSG_MRR_DATES } };
    }
    const { error } = await supabase
      .from("deals")
      .update({ mrr_start: monthToDate(mrrStart), contract_months: months })
      .eq("id", dealId);
    if (error) return dbFailure(error);
  } else if (needed === "setup") {
    const first = dates.data.setupFirstDue;
    if (!first) return { ok: false, error: MSG_SETUP_DATE, fieldErrors: { setupFirstDue: MSG_SETUP_DATE } };
    const { error } = await supabase.from("deals").update({ setup_first_due: monthToDate(first) }).eq("id", dealId);
    if (error) return dbFailure(error);
  }

  const last = await supabase
    .from("deal_items")
    .select("position")
    .eq("deal_id", dealId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) return { ok: false, error: SAVE_FAILED };
  const { data, error } = await supabase
    .from("deal_items")
    .insert({
      deal_id: dealId,
      company_id: deal.data.company_id,
      product_id: item.productId,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      discount: item.discount,
      position: (last.data?.position ?? -1) + 1,
    })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  touched();
  return { ok: true, data: { id: data.id } };
}

/** Quantidade, preço e desconto; o produto do item não muda. */
export async function updateDealItem(itemId: string, input: DealItemUpdateInput): Promise<DealResult> {
  if (!uuid.safeParse(itemId).success) return INVALID;
  const parsed = dealItemUpdateSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "quantity");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("deal_items")
    .update({ quantity: parsed.data.quantity, unit_price: parsed.data.unitPrice, discount: parsed.data.discount })
    .eq("id", itemId)
    .select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

export async function removeDealItem(itemId: string): Promise<DealResult> {
  if (!uuid.safeParse(itemId).success) return INVALID;
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("deal_items").delete().eq("id", itemId).select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "Registro não encontrado ou sem permissão." };
  touched();
  return { ok: true, data: undefined };
}

/** Converte o lead em negócio (RPC `convert_lead`); falta de obrigatórios da etapa volta em `missing`. */
export async function convertLead(
  leadId: string,
  input: { pipelineId: string; stageId: string; title?: string | null },
): Promise<DealResult<{ dealId: string }>> {
  if (!uuid.safeParse(leadId).success || !uuid.safeParse(input.pipelineId).success || !uuid.safeParse(input.stageId).success) {
    return INVALID;
  }
  const title = (input.title ?? "").trim();
  if (title.length > 200) return { ok: false, error: "Use no máximo 200 caracteres.", fieldErrors: { title: "Use no máximo 200 caracteres." } };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: NO_PERMISSION };
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("convert_lead", {
    p_lead: leadId,
    p_pipeline: input.pipelineId,
    p_stage: input.stageId,
    p_title: title === "" ? null : title,
  });
  if (error) return dbFailure(error);
  touched();
  return { ok: true, data: { dealId: data as string } };
}
