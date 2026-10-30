import type { contractSchema } from "./schema";
import type { z } from "zod";

/**
 * Colunas de fin_contracts a partir do formulário validado. adjust_rate vale para qualquer reajuste
 * (no índice é a estimativa do índice usada na projeção); sem reajuste fica 0.
 */
export function contractColumns(v: z.output<typeof contractSchema>) {
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
    adjust_rate: v.adjustKind === "none" ? 0 : v.adjustRate,
    notes: v.notes,
  };
}
