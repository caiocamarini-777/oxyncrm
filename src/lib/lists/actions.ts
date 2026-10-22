"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/session";
import { createServerClient } from "@/lib/supabase/server";
import { translateDbError, type ActionResult } from "@/lib/db-errors";

export type ListKind = "source" | "reason" | "lost_reason";

const TABLES = { source: "lead_sources", reason: "disqualification_reasons", lost_reason: "lost_reasons" } as const;
const PATHS = { source: "/configuracoes/origens", reason: "/configuracoes/motivos", lost_reason: "/configuracoes/motivos-perda" } as const;

const nameSchema = z.string().trim().min(1, "Informe o nome.").max(80, "Use no máximo 80 caracteres.");

function nameFailure(message: string): ActionResult<never> {
  return { ok: false, error: message, fieldErrors: { name: message } };
}

function dbFailure(err: { code?: string; message?: string }): ActionResult<never> {
  if (err.code === "23505") return nameFailure("Já existe um item com esse nome.");
  return { ok: false, error: translateDbError(err) };
}

function validKind(kind: string): kind is ListKind {
  return kind === "source" || kind === "reason" || kind === "lost_reason";
}

export async function createListItem(
  kind: ListKind,
  companyId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  await requireSuperAdmin();
  if (!validKind(kind) || !z.string().uuid().safeParse(companyId).success) {
    return { ok: false, error: "Dados inválidos." };
  }
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return nameFailure(parsed.error.issues[0].message);
  const supabase = await createServerClient();
  const table = TABLES[kind];
  const { data: last } = await supabase
    .from(table)
    .select("position")
    .eq("company_id", companyId)
    .order("position", { ascending: false })
    .limit(1);
  const position = (last?.[0]?.position ?? -1) + 1;
  const { data, error } = await supabase
    .from(table)
    .insert({ company_id: companyId, name: parsed.data, position })
    .select("id")
    .single();
  if (error) return dbFailure(error);
  revalidatePath(PATHS[kind]);
  return { ok: true, data: { id: data.id } };
}

export async function renameListItem(kind: ListKind, id: string, name: string): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!validKind(kind)) return { ok: false, error: "Dados inválidos." };
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return nameFailure(parsed.error.issues[0].message);
  const supabase = await createServerClient();
  const { error } = await supabase.from(TABLES[kind]).update({ name: parsed.data }).eq("id", id);
  if (error) return dbFailure(error);
  revalidatePath(PATHS[kind]);
  return { ok: true, data: undefined };
}

/** Item inativo some dos formulários, mas segue nos registros que já o usam. */
export async function setListItemActive(kind: ListKind, id: string, active: boolean): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!validKind(kind)) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const { error } = await supabase.from(TABLES[kind]).update({ active }).eq("id", id);
  if (error) return { ok: false, error: translateDbError(error) };
  revalidatePath(PATHS[kind]);
  return { ok: true, data: undefined };
}

/** Renumera a lista inteira (posições podem estar empatadas) e troca o item com o vizinho. */
export async function moveListItem(
  kind: ListKind,
  id: string,
  direction: "up" | "down",
): Promise<ActionResult> {
  await requireSuperAdmin();
  if (!validKind(kind)) return { ok: false, error: "Dados inválidos." };
  const supabase = await createServerClient();
  const table = TABLES[kind];
  const { data: item, error: itemError } = await supabase
    .from(table)
    .select("company_id")
    .eq("id", id)
    .single();
  if (itemError) return { ok: false, error: translateDbError(itemError) };
  const { data: rows, error: listError } = await supabase
    .from(table)
    .select("id, position")
    .eq("company_id", item.company_id)
    .order("position")
    .order("name");
  if (listError) return { ok: false, error: translateDbError(listError) };
  const ordered = (rows ?? []).map((r) => r.id);
  const from = ordered.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ordered.length) return { ok: true, data: undefined };
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  const current = new Map((rows ?? []).map((r) => [r.id, r.position]));
  for (const [index, rowId] of ordered.entries()) {
    if (current.get(rowId) === index) continue;
    const { error } = await supabase.from(table).update({ position: index }).eq("id", rowId);
    if (error) return { ok: false, error: translateDbError(error) };
  }
  revalidatePath(PATHS[kind]);
  return { ok: true, data: undefined };
}
