import { CircleDot, ListChecks, Mail, MessageSquare, Phone, Users, type LucideIcon } from "lucide-react";
import { cn } from "cn";
import type { DueStatus } from "@/lib/activities/time";

const STATUS: Record<Exclude<DueStatus, "done">, { label: string; className: string }> = {
  overdue: { label: "Atrasada", className: "bg-red-600/10 text-red-700 dark:text-red-400" },
  today: { label: "Hoje", className: "bg-primary/10 text-primary" },
  upcoming: { label: "Próxima", className: "bg-muted text-muted-foreground" },
};

/** Chip de prazo: vermelho para atrasadas, teal para hoje, cinza para as próximas. */
export function ActivityChip({ status }: { status: DueStatus }) {
  if (status === "done") return null;
  const s = STATUS[status];
  return (
    <span
      data-testid="activity-chip"
      data-status={status}
      className={cn("inline-flex h-5 items-center rounded-full px-2 text-xs font-medium", s.className)}
    >
      {s.label}
    </span>
  );
}

const ICONS: Record<string, LucideIcon> = {
  Tarefa: ListChecks,
  Ligação: Phone,
  Reunião: Users,
  "E-mail": Mail,
  Mensagem: MessageSquare,
};

/** Ícone do tipo pelo nome (tipos novos da empresa caem no ícone genérico). */
export function TypeIcon({ name, isMeeting, className }: { name: string; isMeeting?: boolean; className?: string }) {
  const Icon = ICONS[name] ?? (isMeeting ? Users : CircleDot);
  return <Icon aria-hidden className={cn("size-4", className)} />;
}
