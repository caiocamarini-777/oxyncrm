import "server-only";
import { connection } from "next/server";
import { gmailConfig } from "@/lib/gmail/oauth";
import { defaultMeetDeps, runMeetSync } from "@/lib/meet/run";
import { isCronAuthorized } from "@/lib/notifications/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const BUDGET_MS = 240_000;

/** Rodada do assistente de reuniões do Google Meet (cron a cada 10 min). */
export async function GET(request: Request) {
  await connection();
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }
  // Sem o Claude, o Pipedrive ou o OAuth do Google, não há o que fazer.
  if (!process.env.ANTHROPIC_API_KEY || !process.env.PIPEDRIVE_API_TOKEN || !gmailConfig()) {
    return Response.json({ skipped: "not_configured" });
  }

  try {
    const accounts = await runMeetSync(defaultMeetDeps(createAdminClient()), { budgetMs: BUDGET_MS });
    return Response.json({ accounts });
  } catch (e) {
    console.error("meet: falha na rodada:", e instanceof Error ? e.message : "erro");
    return Response.json({ error: "Falha na rodada do assistente" }, { status: 500 });
  }
}
