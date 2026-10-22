import "server-only";
import type { CompanyScope } from "@/lib/companies/pure";
import { fail as failFor, one, type Rel } from "@/lib/records/list-helpers";
import { PAGE_SIZE, type Paged, type RecordEntity } from "@/lib/records/types";
import { createServerClient } from "@/lib/supabase/server";

export const TRASH_DAYS = 30;

export type TrashRow = {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  ownerName: string;
  deletedAt: string;
  purgeAt: string;
};

const NAME_COLUMN: Record<RecordEntity, string> = {
  leads: "title",
  persons: "full_name",
  organizations: "name",
};

export function purgeDate(deletedAt: string): string {
  return new Date(new Date(deletedAt).getTime() + TRASH_DAYS * 86_400_000).toISOString();
}

type Raw = Record<string, unknown> & {
  id: string;
  company_id: string;
  deleted_at: string;
  company: Rel<{ name: string }>;
  owner: Rel<{ full_name: string }>;
};

/** O RLS só mostra registros excluídos a quem tem permissão de excluir. */
export async function listTrash(
  entity: RecordEntity,
  scope: CompanyScope,
  page: number,
): Promise<Paged<TrashRow>> {
  const supabase = await createServerClient();
  const col = NAME_COLUMN[entity];
  let q = supabase
    .from(entity)
    .select(`id, company_id, ${col}, deleted_at, company:companies(name), owner:profiles!owner_id(full_name)`, {
      count: "exact",
    })
    .not("deleted_at", "is", null);
  if (scope.kind === "company") q = q.eq("company_id", scope.company.id);
  const from = (page - 1) * PAGE_SIZE;
  const { data, error, count } = await q
    .order("deleted_at", { ascending: false })
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (error) {
    if (error.code === "PGRST103") return { rows: [], total: 0, page, pageSize: PAGE_SIZE };
    failFor(entity, "lixeira", error);
  }
  const rows = ((data ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: one(r.company)?.name ?? "",
    name: String(r[col] ?? ""),
    ownerName: one(r.owner)?.full_name ?? "",
    deletedAt: r.deleted_at,
    purgeAt: purgeDate(r.deleted_at),
  }));
  return { rows, total: count ?? rows.length, page, pageSize: PAGE_SIZE };
}
