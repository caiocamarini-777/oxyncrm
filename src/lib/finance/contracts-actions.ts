"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { translateDbError, type ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { diffLineIds } from "./line-diff";
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
 * Grava o conjunto de linhas do contrato casando por id: as que mantêm o id são atualizadas no
 * lugar (só se mudaram), as novas entram num insert único e as removidas saem num delete único.
 * Os ids ficam estáveis e linhas com lançamentos liquidados/editados não podem ser removidas.
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

  const existing = await supabase.from("fin_contract_lines").select("*").eq("contract_id", contractId);
  if (existing.error) return dbFailure(existing.error);
  const byId = new Map((existing.data ?? []).map((l) => [l.id as string, l]));
  const diff = diffLineIds([...byId.keys()], rows);

  // Linha com lançamento liquidado ou editado à mão não pode sumir.
  if (diff.remove.length > 0) {
    const used = await supabase
      .from("fin_entries")
      .select("id", { count: "exact", head: true })
      .in("contract_line_id", diff.remove)
      .or("status.eq.settled,locked.eq.true");
    if (used.error) return dbFailure(used.error);
    if ((used.count ?? 0) > 0)
      return { ok: false, error: "Esta linha já tem lançamentos liquidados ou editados e não pode ser removida." };
    const del = await supabase.from("fin_contract_lines").delete().in("id", diff.remove);
    if (del.error) return dbFailure(del.error);
  }

  const columns = (r: (typeof rows)[number]) => ({
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
  });
  const same = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    Object.keys(b).every((k) => (a[k] === null || b[k] === null ? a[k] === b[k] : String(a[k]) === String(b[k]) || Number(a[k]) === Number(b[k])));

  for (const i of diff.update) {
    const cols = columns(rows[i]);
    const cur = byId.get(rows[i].id as string)!;
    if (same(cur, cols)) continue;
    const up = await supabase.from("fin_contract_lines").update(cols).eq("id", rows[i].id as string);
    if (up.error) return dbFailure(up.error);
  }
  if (diff.insert.length > 0) {
    const ins = await supabase
      .from("fin_contract_lines")
      .insert(diff.insert.map((i) => ({ contract_id: contractId, company_id: companyId, ...columns(rows[i]) })));
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
