import "server-only";
import type { z } from "zod";
import { validateCustomFieldValues } from "@/lib/custom-fields/schema";
import { changedCustomFieldValues } from "./custom-fields-diff";
import { listActiveCustomFieldDefs } from "./lookups";
import { listAssignableOwners } from "./owners";
import type { RecordEntity } from "./types";

/**
 * Primeiro erro do zod como `{ field, message }`. `resolveField` pode mapear o caminho para o
 * id do campo do formulário (ex.: `address.zip` vira `zip`); sem retorno, vale o primeiro item.
 */
export function firstIssue(
  err: z.ZodError,
  defaultField: string,
  resolveField?: (path: PropertyKey[]) => string | undefined,
): { field: string; message: string } {
  const issue = err.issues[0];
  const field = resolveField?.(issue.path) ?? String(issue.path[0] ?? defaultField);
  return { field, message: issue.message };
}

export async function checkCustomFields(
  companyId: string,
  entity: RecordEntity,
  values: Record<string, unknown>,
  /** Valores já gravados (edição): só as chaves alteradas são validadas. */
  current?: Record<string, unknown> | null,
): Promise<{ ok: true } | { ok: false; error: string; key: string }> {
  const [defs, owners] = await Promise.all([
    listActiveCustomFieldDefs(companyId, entity),
    listAssignableOwners(companyId),
  ]);
  const toCheck = current === undefined ? values : changedCustomFieldValues(values, current);
  const res = validateCustomFieldValues(defs, toCheck, owners.map((o) => o.id));
  return res.ok ? res : { ok: false, error: res.message, key: res.key };
}
