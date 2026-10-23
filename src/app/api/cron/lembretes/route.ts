import "server-only";
import { connection } from "next/server";
import { sendEmail } from "@/lib/email/send";
import { reminderEmail } from "@/lib/email/templates";
import { isCronAuthorized } from "@/lib/notifications/cron-auth";
import { reminderPath, type ReminderLinks } from "@/lib/notifications/link";
import { createAdminClient } from "@/lib/supabase/admin";

const WINDOW_MINUTES = 60;

type Row = {
  id: number;
  title: string;
  due_at: string | null;
  profiles: { email: string; full_name: string; active: boolean } | null;
  companies: { slug: string } | null;
  activities: (ReminderLinks & { subject: string }) | null;
};

export async function GET(request: Request) {
  await connection();
  if (!isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  const db = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from("notifications")
    .select(
      "id, title, due_at, profiles(email, full_name, active), companies(slug), activities(subject, deal_id, lead_id, person_id, organization_id)",
    )
    .eq("kind", "activity_reminder")
    .is("email_sent_at", null)
    .gte("created_at", since)
    .order("id")
    .limit(500)
    .overrideTypes<Row[], { merge: false }>();
  if (error) {
    console.error("lembretes: falha ao listar notificações:", error.message);
    return Response.json({ error: "Falha ao listar lembretes" }, { status: 500 });
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const n of data) {
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
    const to = n.profiles;
    if (!to?.active || !to.email) continue; // reivindicada de propósito: usuário inativo não recebe e-mail
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
  return Response.json({ sent, skipped, failed });
}
