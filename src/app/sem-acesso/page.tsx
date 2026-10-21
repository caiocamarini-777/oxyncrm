import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies } from "@/lib/companies/scope";

async function Content() {
  const profile = await requireUser();
  const companies = await getAccessibleCompanies();
  if (companies.length > 0) redirect("/");
  if (profile.isSuperAdmin) redirect("/configuracoes/empresas");
  return (
    <div className="grid max-w-md gap-4 text-center">
      <h1 className="font-heading text-2xl font-semibold">
        Você ainda não tem acesso a nenhuma empresa
      </h1>
      <p className="text-muted-foreground">Peça ao administrador para liberar seu acesso.</p>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sair
        </Button>
      </form>
    </div>
  );
}

export default function NoAccessPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense>
        <Content />
      </Suspense>
    </main>
  );
}
