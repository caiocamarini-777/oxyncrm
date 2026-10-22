import { cache } from "react";
import { connection } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import type { CompanySummary } from "./pure";

export * from "./pure";

/** O RLS já limita ao que o usuário enxerga; aqui só tiramos as arquivadas. */
export const getAccessibleCompanies = cache(async (): Promise<CompanySummary[]> => {
  await connection(); // roda em paralelo com requireUser; o cliente Supabase lê o relógio
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("companies")
    .select("id, name, slug, logo_url")
    .is("archived_at", null)
    .order("name");
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    logoUrl: c.logo_url,
  }));
});
