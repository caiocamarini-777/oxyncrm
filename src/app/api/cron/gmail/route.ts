import "server-only";
import { connection } from "next/server";
import { gmailConfig } from "@/lib/gmail/oauth";
import { runGmailSync } from "@/lib/gmail/run";
import { isCronAuthorized } from "@/lib/notifications/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const BUDGET_MS = 240_000;

export async function GET(request: Request) {
  await connection();
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }
  if (!gmailConfig()) return Response.json({ skipped: "not_configured" });

  try {
    const accounts = await runGmailSync(createAdminClient(), { budgetMs: BUDGET_MS });
    return Response.json({ accounts });
  } catch (e) {
    console.error("gmail: falha na sincronização:", e instanceof Error ? e.message : "erro");
    return Response.json({ error: "Falha na sincronização" }, { status: 500 });
  }
}
