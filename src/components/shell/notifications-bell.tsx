"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime } from "@/lib/activities/time";
import { reminderPath, type ReminderLinks } from "@/lib/notifications/link";
import { createBrowserClient } from "@/lib/supabase/client";

type Item = {
  id: number;
  title: string;
  due_at: string | null;
  read_at: string | null;
  href: string;
};

type Raw = {
  id: number;
  title: string;
  due_at: string | null;
  read_at: string | null;
  companies: { slug: string } | null;
  activities: ReminderLinks | null;
};

const SELECT = "id, title, due_at, read_at, companies(slug), activities(deal_id, lead_id, person_id, organization_id)";

const toItem = (r: Raw): Item => ({
  id: r.id,
  title: r.title,
  due_at: r.due_at,
  read_at: r.read_at,
  href: reminderPath(r.companies?.slug ?? null, r.activities),
});

export function NotificationsBell() {
  const supabase = useMemo(() => createBrowserClient(), []);
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const [list, count] = await Promise.all([
      supabase.from("notifications").select(SELECT).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(20).overrideTypes<Raw[], { merge: false }>(),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    ]);
    const mapped = list.error ? null : list.data.map(toItem);
    if (mapped) setItems(mapped);
    if (!count.error) setUnread(count.count ?? 0);
    return mapped;
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (cancelled || !userId) return;
      await load();
      if (cancelled) return;
      // RLS continua valendo no Realtime; o filtro evita receber eventos de outros usuários.
      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          (payload) => {
            // Uma única consulta por evento: a lista já traz o destino do aviso.
            const row = payload.new as { id?: number; title?: string };
            void load().then((list) => {
              if (payload.eventType !== "INSERT" || row.id === undefined) return;
              const href = list?.find((i) => i.id === row.id)?.href;
              toast(row.title ?? "Lembrete", {
                action: href ? { label: "Abrir", onClick: () => router.push(href) } : undefined,
              });
            });
          },
        )
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, load, router]);

  async function markRead(id: number) {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
    void load();
  }

  async function markAll() {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    void load();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread > 0 ? `Notificações, ${unread} não lidas` : "Notificações"}>
          <Bell className="size-4" />
          {unread > 0 && (
            <span
              data-testid="notifications-count"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notificações</p>
          <Button variant="ghost" size="sm" disabled={unread === 0} onClick={() => void markAll()}>
            Marcar todas como lidas
          </Button>
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma notificação.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} data-testid="notification-item" data-unread={n.read_at ? "false" : "true"}>
                <Link
                  href={n.href}
                  onClick={() => {
                    setOpen(false);
                    if (!n.read_at) void markRead(n.id);
                  }}
                  className="flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-accent"
                >
                  <span className={n.read_at ? "text-muted-foreground" : "font-medium"}>{n.title}</span>
                  {n.due_at && <span className="text-xs text-muted-foreground">{formatDateTime(n.due_at)}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
