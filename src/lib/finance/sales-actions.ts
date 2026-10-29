"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/db-errors";
import { firstIssue } from "@/lib/records/action-helpers";
import { createServerClient } from "@/lib/supabase/server";
import { getFinanceAccess } from "./permissions";
import { saleSchema, type SaleInput } from "./sales-schema";

const uuid = z.string().uuid();
const INVALID = "Dados inválidos.";
const LOCKED = "Esta venda já tem comissão recebida e não pode ser alterada.";

function done(): void {
  revalidatePath("/[empresa]/vendas", "page");
  revalidatePath("/[empresa]/financeiro", "layout");
}

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  const msg = err.message ?? "";
  if (msg.includes(LOCKED)) return { ok: false, error: LOCKED };
  if (err.code === "42501" || msg.includes("OXYN_FORBIDDEN")) return { ok: false, error: "Sem permissão." };
  if (err.code === "23503") return { ok: false, error: "Este registro está em uso." };
  return { ok: false, error: "Não foi possível concluir. Tente novamente." };
}

/** Cria (id nulo) ou edita uma venda; o vendedor só enxerga o contrato e a linha, nunca os percentuais. */
export async function saveSale(companyId: string, id: string | null, input: SaleInput): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(companyId).success || (id !== null && !uuid.safeParse(id).success)) return { ok: false, error: INVALID };
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error, "buyer");
    return { ok: false, error: message, fieldErrors: { [field]: message } };
  }
  const v = parsed.data;
  const supabase = await createServerClient();

  // O contrato vem da linha escolhida, dentre as que este usuário pode usar.
  const options = await supabase.rpc("fin_sales_contracts", { p_company: companyId });
  if (options.error) return dbFailure(options.error);
  const option = (options.data ?? []).find((o: { line_id: string }) => o.line_id === v.contractLineId);
  if (!option) return { ok: false, error: "Escolha o contrato.", fieldErrors: { contractLineId: "Escolha o contrato." } };

  const { data, error } = await supabase.rpc("fin_save_sale", {
    p_id: id as string,
    p_payload: {
      contract_id: option.contract_id,
      line_id: v.contractLineId,
      buyer: v.buyer,
      sold_on: v.soldOn,
      setup_value: v.setupValue,
      setup_installments: v.setupInstallments,
      setup_first_month: v.setupValue > 0 ? v.setupFirstMonth : null,
      recurring_value: v.recurringValue,
      recurring_start: v.recurringValue > 0 ? v.recurringStart : null,
      recurring_months: v.recurringValue > 0 ? v.recurringMonths : null,
      note: v.note,
    },
  });
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: { id: data as string } };
}

export async function cancelSale(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: INVALID };
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("fin_cancel_sale", { p_id: id });
  if (error) return dbFailure(error);
  done();
  return { ok: true, data: undefined };
}

/** Define quem pode registrar vendas no contrato (vazio: qualquer vendedor da empresa). Exige manage. */
export async function setContractSellers(contractId: string, userIds: string[]): Promise<ActionResult> {
  if (!uuid.safeParse(contractId).success || !Array.isArray(userIds) || userIds.length > 200) return { ok: false, error: INVALID };
  if (!userIds.every((u) => uuid.safeParse(u).success)) return { ok: false, error: INVALID };
  const wanted = [...new Set(userIds)];
  const supabase = await createServerClient();
  const contract = await supabase.from("fin_contracts").select("company_id").eq("id", contractId).maybeSingle();
  if (contract.error) return dbFailure(contract.error);
  if (!contract.data) return { ok: false, error: "Contrato não encontrado." };
  const companyId = contract.data.company_id;
  if (!(await getFinanceAccess(companyId)).manage) return { ok: false, error: "Sem permissão." };

  const current = await supabase.from("fin_contract_sellers").select("user_id").eq("contract_id", contractId);
  if (current.error) return dbFailure(current.error);
  const have = new Set((current.data ?? []).map((r) => r.user_id as string));
  const remove = [...have].filter((u) => !wanted.includes(u));
  const add = wanted.filter((u) => !have.has(u));
  if (remove.length > 0) {
    const del = await supabase.from("fin_contract_sellers").delete().eq("contract_id", contractId).in("user_id", remove);
    if (del.error) return dbFailure(del.error);
  }
  if (add.length > 0) {
    const ins = await supabase
      .from("fin_contract_sellers")
      .insert(add.map((user_id) => ({ contract_id: contractId, user_id, company_id: companyId })));
    if (ins.error) return dbFailure(ins.error);
  }
  done();
  return { ok: true, data: undefined };
}
