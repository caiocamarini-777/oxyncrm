import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { NewImportButton } from "@/components/import/new-import-button";
import { requireSuperAdmin } from "@/lib/auth/session";
import { listImportJobs } from "@/lib/import/queries";
import { STATUS_LABELS, STEP_LABELS } from "@/lib/import/wizard";

export const instant = false;

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export default async function ImportsPage() {
  await requireSuperAdmin();
  const jobs = await listImportJobs();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold">Importação do Pipedrive</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Traz funis, contatos, leads, negócios, atividades e anotações do Pipedrive. O token é lido do ambiente do
            servidor. Rodar a mesma importação de novo atualiza os registros sem duplicar.
          </p>
        </div>
        <NewImportButton />
      </div>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma importação ainda.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Criada em</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Etapa</th>
                <th className="px-3 py-2 text-right font-medium">Criados</th>
                <th className="px-3 py-2 text-right font-medium">Erros</th>
                <th className="px-3 py-2 font-medium">Por</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link href={`/configuracoes/importacao/${j.id}`} className="font-medium text-brand hover:underline">
                      {dateTime.format(new Date(j.createdAt))}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={j.status === "failed" ? "destructive" : j.status === "done" ? "default" : "secondary"}>
                      {STATUS_LABELS[j.status] ?? j.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {j.status === "draft" || j.status === "done" ? "" : (STEP_LABELS[j.step ?? ""] ?? "")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{j.created}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{j.errors}</td>
                  <td className="px-3 py-2 text-muted-foreground">{j.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
