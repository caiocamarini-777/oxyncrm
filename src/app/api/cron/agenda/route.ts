import "server-only";
import { connection } from "next/server";
import { calendarClientForAccount } from "@/lib/calendar/google";
import { runCalendarSync } from "@/lib/calendar/sync";
import { gmailConfig } from "@/lib/gmail/oauth";
import { isCronAuthorized } from "@/lib/notifications/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const BUDGET_MS = 240_000;

/** Rodada da sincronização com a Agenda do Google (cron a cada 5 min). */
export async function GET(request: Request) {
  await connection();
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }
  // Sem o OAuth do Google, não há como ler nem gravar na Agenda.
  if (!gmailConfig()) return Response.json({ skipped: "not_configured" });

  try {
    const accounts = await runCalendarSync(
      {
        db: createAdminClient(),
        clientFor: calendarClientForAccount,
        now: () => new Date(),
        // Base do link "No CRM" na descrição do evento; sem ela, o evento vai sem o link.
        appUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
      },
      { budgetMs: BUDGET_MS },
    );
    return Response.json({ accounts });
  } catch (e) {
    console.error("agenda: falha na rodada:", e instanceof Error ? e.message : "erro");
    return Response.json({ error: "Falha na sincronização da Agenda" }, { status: 500 });
  }
}
