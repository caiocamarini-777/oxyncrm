import Link from "next/link";
import { notFound } from "next/navigation";
import { NewContractForm } from "@/components/finance/contract-form";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { CONTRACT_STATUS_LABEL } from "@/lib/finance/labels";
import { listContracts, type ContractStatus } from "@/lib/finance/queries";
import { cn } from "cn";

export const instant = false;

const GROUPS: { key: string; label: string; statuses: ContractStatus[] }[] = [
  { key: "pendentes", label: "Pendentes", statuses: ["draft"] },
  { key: "ativos", label: "Ativos", statuses: ["active"] },
  { key: "encerrados", label: "Encerrados", statuses: ["ended", "cancelled"] },
];

export default async function FinanceContractsPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ empresa }, sp, profile, companies] = await Promise.all([params, searchParams, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all") notFound();
  const company = scope.company;

  const raw = Array.isArray(sp.aba) ? sp.aba[0] : sp.aba;
  const group = GROUPS.find((g) => g.key === raw) ?? GROUPS[0];
  const [access, { rows, pending }] = await Promise.all([getFinanceAccess(company.id), listContracts(company.id, group.statuses)]);
  const base = `/${company.slug}/financeiro/contratos`;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Contratos" className="flex gap-1 border-b">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={g.key === "pendentes" ? base : `${base}?aba=${g.key}`}
            aria-current={g.key === group.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              g.key === group.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {g.key === "pendentes" ? `${g.label} (${pending})` : g.label}
          </Link>
        ))}
      </nav>
      {access.manage ? <NewContractForm companyId={company.id} empresa={company.slug} /> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum contrato aqui.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Contrato</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`${base}/${c.id}`} className="font-medium underline-offset-2 hover:underline">{c.title}</Link>
                  </td>
                  <td className="px-3 py-2">{c.organizationName ?? "—"}</td>
                  <td className="px-3 py-2">{CONTRACT_STATUS_LABEL[c.status]}</td>
                  <td className="px-3 py-2">{c.sourceChanged ? <Badge variant="outline">Negócio mudou</Badge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
