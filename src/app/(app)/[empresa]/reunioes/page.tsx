import { Suspense } from "react";
import { notFound } from "next/navigation";
import { MeetingsTable } from "@/components/meetings/meetings-table";
import { MeetingsTabs } from "@/components/meetings/meetings-tabs";
import { Pagination } from "@/components/records/pagination";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { listMeetings } from "@/lib/meet/queries";
import { parseMeetingTab } from "@/lib/meet/view";

export const instant = false;

const HINTS = {
  pendentes: "Reuniões com sugestões do assistente esperando decisão. As pendentes há mais de 24 h ficam em destaque.",
  "sem-vinculo":
    "Reuniões sem registro no CRM são descartadas sozinhas em 7 dias; as de cards excluídos ficam até você vincular ou descartar.",
  "com-erro": "Reuniões que o assistente não conseguiu processar. Tente de novo ou descarte.",
  todas: "Todas as reuniões que você pode ver, menos as descartadas.",
} as const;

export default async function MeetingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ empresa }, raw, profile, companies] = await Promise.all([
    params,
    searchParams,
    requireUser(),
    getAccessibleCompanies(),
  ]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  const aba = Array.isArray(raw.aba) ? raw.aba[0] : raw.aba;
  const tab = parseMeetingTab(aba);
  const rawPage = Number(Array.isArray(raw.page) ? raw.page[0] : raw.page);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const result = await listMeetings(scope, tab, page, { id: profile.id, isSuperAdmin: profile.isSuperAdmin });
  const scopeSlug = scope.kind === "all" ? "todas" : scope.company.slug;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Reuniões</h1>
      <p className="text-sm text-muted-foreground">{HINTS[tab]}</p>
      <MeetingsTabs scopeSlug={scopeSlug} active={tab} />
      {result.failed ? (
        <p role="alert" className="rounded-lg border p-8 text-center text-muted-foreground">
          Não foi possível carregar as reuniões agora. Tente novamente em instantes.
        </p>
      ) : (
        <>
          <MeetingsTable rows={result.rows} tab={tab} allCompanies={scope.kind === "all"} />
          <Suspense>
            <Pagination total={result.total} page={result.page} />
          </Suspense>
        </>
      )}
    </div>
  );
}
