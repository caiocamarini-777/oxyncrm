import "server-only";
import { createServerClient } from "@/lib/supabase/server";

export type NotificationRow = {
  id: number;
  companyId: string | null;
  activityId: string | null;
  title: string;
  body: string | null;
  dueAt: string | null;
  createdAt: string;
  read: boolean;
};

export type NotificationList = { items: NotificationRow[]; unread: number };

/** Notificações do usuário (RLS: só as próprias), mais recentes primeiro, e o total de não lidas. */
export async function listNotifications(limit = 20): Promise<NotificationList> {
  const supabase = await createServerClient();
  const size = Math.min(Math.max(Math.trunc(limit) || 20, 1), 100);
  const [list, unread] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, company_id, activity_id, title, body, due_at, created_at, read_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(size),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (list.error) {
    console.error("[notificações] lista:", list.error.code, list.error.message);
    throw new Error("Falha ao carregar notificações.");
  }
  if (unread.error) {
    console.error("[notificações] não lidas:", unread.error.code, unread.error.message);
    throw new Error("Falha ao carregar notificações.");
  }
  return {
    unread: unread.count ?? 0,
    items: list.data.map((n) => ({
      id: n.id,
      companyId: n.company_id,
      activityId: n.activity_id,
      title: n.title,
      body: n.body,
      dueAt: n.due_at,
      createdAt: n.created_at,
      read: n.read_at !== null,
    })),
  };
}
