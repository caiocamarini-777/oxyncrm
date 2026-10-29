import Link from "next/link";
import { notFound } from "next/navigation";
import { ContractForm } from "@/components/finance/contract-form";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { todaySaoPaulo } from "@/lib/finance/dates";
import { NATURE_LABEL, STATUS_LABEL } from "@/lib/finance/export";
import { CONTRACT_STATUS_LABEL } from "@/lib/finance/labels";
import { getFinanceAccess } from "@/lib/finance/permissions";
import { getContract, listFinanceLookups, listOrganizations } from "@/lib/finance/queries";
import { formatDate, formatMoney } from "@/lib/records/format";
import { z } from "zod";

export const instant = false;

export default async function FinanceContractPage({ params }: { params: Promise<{ empresa: string; id: string }> }) {
  const [{ empresa, id }, profile, companies] = await Promise.all([params, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind === "all" || !z.string().uuid().safeParse(id).success) notFound();
  const company = scope.company;

  const [access, contract, organizations, lookups] = await Promise.all([
    getFinanceAccess(company.id),
    getContract(company.id, id),
    listOrganizations(company.id),
    listFinanceLookups(company.id),
  ]);
  if (!contract) notFound();
  const today = todaySaoPaulo();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/${company.slug}/financeiro/contratos`} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
          ← Contratos
        </Link>
        <h2 className="font-heading text-lg font-semibold">{contract.title}</h2>
        <Badge variant="secondary">{CONTRACT_STATUS_LABEL[contract.status]}</Badge>
      </div>
      <ContractForm
        key={`${contract.id}:${contract.status}:${contract.sourceChanged}`}
        contract={contract}
        empresa={company.slug}
        organizations={organizations}
        accounts={lookups.accounts}
        canManage={access.manage}
        canCreateServiceCategory={profile.isSuperAdmin}
        defaultMonth={today.slice(0, 7)}
      />
      <section className="flex flex-col gap-2" aria-label="Lançamentos do contrato">
        <h2 className="font-heading text-base font-semibold">Lançamentos</h2>
        {contract.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Os lançamentos aparecem aqui depois que o contrato é ativado.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Vencimento</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {contract.entries.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="px-3 py-2">{formatDate(e.dueDate)}</td>
                    <td className="px-3 py-2">
                      {e.description}
                      {e.nature ? <span className="ml-2 text-xs text-muted-foreground">{NATURE_LABEL[e.nature]}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(e.amount)}</td>
                    <td className="px-3 py-2">{STATUS_LABEL[e.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
