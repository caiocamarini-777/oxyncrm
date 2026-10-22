import "server-only";
import type { LabelColor } from "@/lib/custom-fields/schema";
import { createServerClient } from "@/lib/supabase/server";
import type { RecordEntity } from "./types";

export type LabelRef = { id: string; name: string; color: LabelColor };
export type Rel<T> = T | T[] | null;

const PLURAL: Record<RecordEntity, string> = {
  organizations: "organizações",
  persons: "pessoas",
  leads: "leads",
};

/** Embed do PostgREST pode vir como objeto ou lista de um item. */
export function one<T>(v: Rel<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Registra no servidor e interrompe: falha de consulta não pode virar "sem resultados". */
export function fail(
  entity: RecordEntity | "configurações",
  what: string,
  error: { message: string; code?: string },
): never {
  console.error(`[${entity}] ${what}:`, error.code, error.message);
  const label = entity === "configurações" ? entity : PLURAL[entity];
  throw new Error(`Falha ao carregar ${label} (${what}).`);
}

/** Remove caracteres que quebram a sintaxe do filtro `or` do PostgREST. */
export function safeTerm(q: string): string {
  return q.replace(/[,()*%\\"]/g, " ").replace(/\s+/g, " ").trim();
}

export function startOfDay(d: string): string {
  return `${d}T00:00:00-03:00`;
}
export function endOfDay(d: string): string {
  return `${d}T23:59:59.999-03:00`;
}

/** Ids filtrados por etiqueta; `null` = sem filtro, `[]` = nenhum registro. */
export async function idsByLabels(entity: RecordEntity, labels: string[]): Promise<string[] | null> {
  if (labels.length === 0) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("record_labels")
    .select("record_id")
    .eq("entity", entity)
    .in("label_id", labels);
  if (error) fail(entity, "filtro de etiquetas", error);
  return [...new Set((data ?? []).map((r) => r.record_id as string))];
}

/** Etiquetas por registro, ordenadas por nome. */
export async function loadRecordLabels(entity: RecordEntity, ids: string[]): Promise<Map<string, LabelRef[]>> {
  const out = new Map<string, LabelRef[]>();
  if (ids.length === 0) return out;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("record_labels")
    .select("record_id, label:labels(id, name, color)")
    .eq("entity", entity)
    .in("record_id", ids);
  if (error) fail(entity, "etiquetas", error);
  for (const l of (data ?? []) as unknown as { record_id: string; label: Rel<LabelRef> }[]) {
    const label = one(l.label);
    if (!label) continue;
    out.set(l.record_id, [...(out.get(l.record_id) ?? []), label]);
  }
  for (const [k, v] of out) out.set(k, v.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
  return out;
}

const BATCH = 1000;
const MAX_ROWS = 50_000;

/** Lê a lista em lotes de 1000 (até 50 mil linhas) e converte cada linha para o CSV. */
export async function exportInBatches<T>(
  fetchPage: (range: { from: number; to: number }) => Promise<{ rows: T[] }>,
  toRow: (r: T) => Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += BATCH) {
    const { rows } = await fetchPage({ from, to: from + BATCH - 1 });
    out.push(...rows.map(toRow));
    if (rows.length < BATCH) break;
  }
  return out;
}
