import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { ServiceCategoriesManager, type ServiceCategoryRow } from "@/components/settings/service-categories-manager";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function ServiceCategoriesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  await requireSuperAdmin();
  const { empresa } = await searchParams;
  const { companies, selected } = await resolveSettingsCompany(empresa);
  if (!selected) return <NoCompany />;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("service_categories")
    .select("id, name, color, active")
    .eq("company_id", selected.id)
    .order("position")
    .order("name");
  if (error) fail("configurações", "categorias de serviço", error);
  const categories: ServiceCategoryRow[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    active: c.active,
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Categorias de serviço</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <p className="text-sm text-muted-foreground">
        Classificam produtos, negócios e itens. Categorias inativas não aparecem nos seletores, mas continuam nos registros que já as usam. Arraste para reordenar.
      </p>
      <ServiceCategoriesManager key={selected.id} companyId={selected.id} categories={categories} />
    </div>
  );
}
