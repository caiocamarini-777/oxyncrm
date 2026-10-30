import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { ProductsManager, type ProductRow } from "@/components/settings/products-manager";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function ProductsSettingsPage({
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
    .from("products")
    .select("id, name, kind, default_price, active, service_category_id, category:service_categories(name)")
    .eq("company_id", selected.id)
    .order("name");
  if (error) fail("configurações", "produtos", error);
  const products: ProductRow[] = (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind as ProductRow["kind"],
    defaultPrice: Number(p.default_price),
    active: p.active,
    serviceCategoryId: p.service_category_id,
    serviceCategoryName: (Array.isArray(p.category) ? p.category[0] : p.category)?.name ?? null,
  }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Produtos</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <p className="text-sm text-muted-foreground">Produtos inativos não aparecem ao adicionar itens, mas continuam nos negócios que já os usam.</p>
      <ProductsManager key={selected.id} companyId={selected.id} products={products} />
    </div>
  );
}
