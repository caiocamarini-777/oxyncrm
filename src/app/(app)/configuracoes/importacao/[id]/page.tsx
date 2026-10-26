import Link from "next/link";
import { notFound } from "next/navigation";
import { ImportProgress } from "@/components/import/import-progress";
import { ImportWizard } from "@/components/import/import-wizard";
import { requireSuperAdmin } from "@/lib/auth/session";
import { loadDiscovery } from "@/lib/import/discovery";
import { loadImportJob, loadOxynData } from "@/lib/import/queries";
import { DraftMappings, emptyDraft } from "@/lib/import/wizard";
import { isUuid } from "@/lib/uuid";

export const instant = false;
// as actions da página (fatias de ~10s e simulação com teto de ~45s, mais uma unidade) cabem neste limite
export const maxDuration = 60;

export default async function ImportJobPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const job = await loadImportJob(id);
  if (!job) notFound();

  const header = (
    <div className="flex flex-col gap-1">
      <Link href="/configuracoes/importacao" className="text-sm text-muted-foreground hover:underline">
        Importações
      </Link>
      <h1 className="font-heading text-2xl font-semibold">Importação do Pipedrive</h1>
    </div>
  );

  if (job.status !== "draft") {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <ImportProgress
          key={job.id}
          job={{
            id: job.id,
            status: job.status,
            step: job.step,
            counters: job.counters,
            errors: job.errors,
            warnings: job.warnings,
          }}
        />
      </div>
    );
  }

  const [discovery, oxyn] = await Promise.all([loadDiscovery(), loadOxynData()]);
  if (!discovery.ok) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {discovery.error}
        </p>
      </div>
    );
  }
  const draft = DraftMappings.safeParse(job.mappings);
  return (
    <div className="flex flex-col gap-4">
      {header}
      <ImportWizard key={job.id} jobId={job.id} discovery={discovery.data} oxyn={oxyn} initial={draft.success ? draft.data : emptyDraft()} />
    </div>
  );
}
