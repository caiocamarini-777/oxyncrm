import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { notFound } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function HomePage({ params }: PageProps<"/[empresa]/inicio">) {
  const [{ empresa }, profile, companies] = await Promise.all([
    params,
    requireUser(),
    getAccessibleCompanies(),
  ]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  const ids = scope.kind === "all" ? companies.map((c) => c.id) : [scope.company.id];
  const supabase = await createServerClient();
  const { data } = await supabase.from("memberships").select("user_id").in("company_id", ids);
  const people = new Set((data ?? []).map((m) => m.user_id)).size;
  const firstName = (profile.fullName || profile.email).split(/[\s@]/)[0];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">
          {scope.kind === "all" ? "Todas as empresas" : scope.company.name}
        </h1>
        <p className="text-muted-foreground">Olá, {firstName}</p>
      </div>
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xs uppercase tracking-wide text-muted-foreground">
            Sua equipe nesta empresa
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-heading text-3xl font-semibold">{people}</p>
          <p className="text-sm text-muted-foreground">
            {people === 1 ? "pessoa com acesso" : "pessoas com acesso"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
