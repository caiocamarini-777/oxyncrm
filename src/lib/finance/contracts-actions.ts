"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { contractLineSchema, contractSchema, type ContractInput, type ContractLineInput } from "./schema";

const uuid = z.string().uuid();
const INVALID = "Dados inválidos.";

function done(): void {
  revalidatePath("/[empresa]/financeiro", "layout");
}

function dbFailure(err: { code?: string; message?: string; details?: string }): ActionResult<never> {
  const msg = err.message ?? "";
  if (msg.includes("OXYN_CONTRACT_NOT_DRAFT")) return { ok: false, error: "Só é possível ativar um contrato pendente." };
  if (msg.includes("Faltam dados para ativar o contrato")) {
    const detail = (err.details ?? "").trim();
    return { ok: false, error: detail ? `Faltam: ${detail}` : "Faltam dados para ativar o contrato." };
  }
  return { ok: false, error: translateDbError(err) };
}

function contractColumns(v: ReturnType<typeof contractSchema.parse>) {
  return {
    title: v.title,
    organization_id: v.organizationId,
    due_day: v.dueDay,
    retention_rate: v.retentionRate,
    account_id: v.accountId,
    end_rule: v.endRule,
    renewal_months: v.endRule === "ends" ? null : v.renewalMonths,
    adjust_kind: v.adjustKind,
    adjust_index: v.adjustKind === "index" ? v.adjustIndex : null,
    adjust_rate: v.adjustKind === "percent" ? v.adjustRate : 0,
    notes: v.notes,
  };
}

function parseContract(input: ContractInput) {
  const parsed = contractSchema.safeParse(input);
  if (parsed.success) return { ok: true as const, data: parsed.data };
  const { field, message } = firstIssue(parsed.error, "title");
  return { ok: false as const, result: { ok: false, error: message, fieldErrors: { [field]: message } } satisfies ActionResult<never> };
}

/** Contrato avulso: nasce como rascunho (pendente) e é ativado depois. */
export async function createContract(companyId: string, input: ContractInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: INVALID };
  const parsed = parseContract(input);
  if (!parsed.ok) return parsed.result;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_contracts")
    .insert({ company_id: companyId, status: "draft", ...contractColumns(parsed.data) })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: { id: data.id } };
}

export async function updateContract(id: string, input: ContractInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const parsed = parseContract(input);
  if (!parsed.ok) return parsed.result;
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("fin_contracts").update(contractColumns(parsed.data)).eq("id", id).select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "Contrato não encontrado." };
  done();
  return { ok: true, data: undefined };
}

/**
 * Substitui o conjunto de linhas do contrato. Cada insert/delete dispara a regeneração dos
 * lançamentos, então são só duas instruções: um delete e um insert de várias linhas.
 */
export async function saveContractLines(contractId: string, lines: ContractLineInput[]): Promise<ActionResult> {
  if (!uuid.safeParse(contractId).success) return { ok: false, error: INVALID };
  if (!Array.isArray(lines) || lines.length > 50) return { ok: false, error: INVALID };
  const rows: ReturnType<typeof contractLineSchema.parse>[] = [];
  for (const [i, line] of lines.entries()) {
    const parsed = contractLineSchema.safeParse(line);
    if (!parsed.success) {
      const { field, message } = firstIssue(parsed.error, "description");
      return { ok: false, error: `Linha ${i + 1}: ${message}`, fieldErrors: { [`${i}.${field}`]: message } };
    }
    rows.push(parsed.data);
  }
  const supabase = await createServerClient();
  const contract = await supabase.from("fin_contracts").select("company_id").eq("id", contractId).maybeSingle();
  if (contract.error) return dbFailure(contract.error);
  if (!contract.data) return { ok: false, error: "Contrato não encontrado." };
  const companyId = contract.data.company_id;

  const del = await supabase.from("fin_contract_lines").delete().eq("contract_id", contractId);
  if (del.error) return dbFailure(del.error);
  if (rows.length > 0) {
    const ins = await supabase.from("fin_contract_lines").insert(
      rows.map((r) => ({
        contract_id: contractId,
        company_id: companyId,
        kind: r.kind,
        description: r.description,
        service_category_id: r.serviceCategoryId,
        amount: r.amount,
        first_month: r.firstMonth,
        installments: r.installments,
        months: r.months,
        setup_rate: r.setupRate,
        recurring_rate: r.recurringRate,
        estimated_monthly: r.estimatedMonthly,
      })),
    );
    if (ins.error) return dbFailure(ins.error);
  }
  done();
  return { ok: true, data: undefined };
}

export async function activateContract(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("fin_activate_contract", { p_contract: id });
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: undefined };
}

export async function cancelContract(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("fin_contracts")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["draft", "active"])
    .select("id");
  if (error) return dbFailure(error);
  if (!data || data.length === 0) return { ok: false, error: "Só é possível cancelar contratos pendentes ou ativos." };
  done();
  return { ok: true, data: undefined };
}

/** "Ciente": o usuário viu que o negócio de origem mudou. */
export async function acknowledgeSourceChange(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { error } = await supabase.from("fin_contracts").update({ source_changed: false }).eq("id", id);
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: undefined };
}
