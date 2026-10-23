import "server-only";
import { connection } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { reminderEmail } from "@/lib/email/templates";
import { emailDecision } from "@/lib/notifications/eligibility";
import { isCronAuthorized } from "@/lib/notifications/cron-auth";
import { reminderPath, type ReminderLinks } from "@/lib/notifications/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const WINDOW_MINUTES = 60;
const BATCH_LIMIT = 100;
const BUDGET_MS = 45_000;

type Row = {
  id: number;
  user_id: string;
  company_id: string | null;
  title: string;
  due_at: string | null;
  profiles: { email: string; full_name: string; active: boolean; is_super_admin: boolean } | null;
  companies: { slug: string } | null;
  activities: (ReminderLinks & { subject: string; done: boolean; deleted_at: string | null; owner_id: string }) | null;
};

export async function GET(request: Request) {
  await connection();
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const siteEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteEnv && process.env.NODE_ENV === "production") {
    console.error("lembretes: NEXT_PUBLIC_SITE_URL não configurada");
    return Response.json({ error: "Configuração ausente" }, { status: 500 });
  }
  const started = Date.now();
  const db = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("notifications")
    .select(
      "id, user_id, company_id, title, due_at, profiles(email, full_name, active, is_super_admin), companies(slug), activities(subject, done, deleted_at, owner_id, deal_id, lead_id, person_id, organization_id)",
    )
    .eq("kind", "activity_reminder")
    .is("email_sent_at", null)
    .gte("created_at", since)
    .order("id")
    .limit(BATCH_LIMIT)
    .overrideTypes<Row[], { merge: false }>();
  if (error) {
    console.error("lembretes: falha ao listar notificações:", error.message);
    return Response.json({ error: "Falha ao listar lembretes" }, { status: 500 });
  }

  // Dono que saiu da empresa não recebe e-mail (super admin conta como membro).
  const memberOf = new Set<string>();
  if (data.length > 0) {
    const { data: ms, error: mErr } = await db
      .from("memberships")
      .select("user_id, company_id")
      .in("user_id", [...new Set(data.map((n) => n.user_id))])
      .in("company_id", [...new Set(data.flatMap((n) => (n.company_id ? [n.company_id] : [])))]);
    if (mErr) {
      console.error("lembretes: falha ao listar vínculos:", mErr.message);
      return Response.json({ error: "Falha ao listar lembretes" }, { status: 500 });
    }
    for (const m of ms) memberOf.add(`${m.user_id}:${m.company_id}`);
  }

  const site = (siteEnv ?? "http://localhost:3000").replace(/\/$/, "");
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let inactive = 0;
  let stale = 0;
  for (const n of data) {
    if (Date.now() - started > BUDGET_MS) break; // o restante entra na próxima execução
    // Reivindica a linha antes de enviar: duas execuções simultâneas não enviam o mesmo e-mail.
    const claim = await db
      .from("notifications")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", n.id)
      .is("email_sent_at", null)
      .select("id");
    if (claim.error || !claim.data?.length) {
      skipped++;
      continue;
    }
    // Reivindicada de propósito nos dois casos abaixo: não há e-mail a enviar.
    const decision = emailDecision({
      userId: n.user_id,
      profile: n.profiles,
      activity: n.activities,
      isMember: Boolean(n.profiles?.is_super_admin) || (n.company_id !== null && memberOf.has(`${n.user_id}:${n.company_id}`)),
    });
    if (decision === "stale") {
      stale++;
      continue;
    }
    if (decision === "inactive") {
      inactive++;
      continue;
    }
    const to = n.profiles!;
    try {
      const subject = n.activities?.subject ?? n.title.replace(/^Lembrete: /, "");
      const msg = reminderEmail({
        fullName: to.full_name,
        subject,
        dueAt: n.due_at,
        link: `${site}${reminderPath(n.companies?.slug ?? null, n.activities)}`,
      });
      await sendEmail({ to: to.email, subject: msg.subject, html: msg.html, text: msg.text });
      sent++;
    } catch (e) {
      failed++;
      console.error("lembretes: falha ao enviar notificação", n.id, e instanceof Error ? e.message : "erro");
      // Devolve a linha para a próxima execução tentar de novo (ainda dentro da janela).
      await db.from("notifications").update({ email_sent_at: null }).eq("id", n.id);
    }
  }
  return Response.json({ sent, skipped, failed, inactive, stale });
}
