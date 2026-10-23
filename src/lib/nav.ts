import {
  BarChart3,
  CalendarCheck,
  Inbox,
  KanbanSquare,
  Mail,
  Settings,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";

/** Fases entregues; E-mail (fase 5) continua desativado. */
export const DELIVERED_PHASES = [1, 2, 3, 4, 6];

export type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  path: string;
  availableFromPhase: number;
  superAdminOnly?: boolean;
  scoped: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { key: "leads", label: "Leads", icon: Inbox, path: "/leads", availableFromPhase: 2, scoped: true },
  { key: "negocios", label: "Negócios", icon: KanbanSquare, path: "/negocios", availableFromPhase: 3, scoped: true },
  { key: "atividades", label: "Atividades", icon: CalendarCheck, path: "/atividades", availableFromPhase: 4, scoped: true },
  { key: "contatos", label: "Contatos", icon: Users, path: "/contatos", availableFromPhase: 2, scoped: true },
  { key: "email", label: "E-mail", icon: Mail, path: "/email", availableFromPhase: 5, scoped: true },
  { key: "relatorios", label: "Relatórios", icon: BarChart3, path: "/relatorios", availableFromPhase: 6, scoped: true },
  { key: "configuracoes", label: "Configurações", icon: Settings, path: "/configuracoes/empresas", availableFromPhase: 1, superAdminOnly: true, scoped: false },
];

/** Destinos que aparecem só na busca (não no menu lateral). */
export const PALETTE_EXTRA_ITEMS: NavItem[] = [
  { key: "lixeira", label: "Lixeira", icon: Trash2, path: "/lixeira", availableFromPhase: 2, scoped: true },
];

export function navHref(item: NavItem, scopeSlug: string): string {
  return item.scoped ? `/${scopeSlug}${item.path}` : item.path;
}

/** Relatórios exigem view_reports (ou admin geral); o resto depende só da fase. */
export function isNavItemEnabled(item: NavItem, isSuperAdmin: boolean, canViewReports = false): boolean {
  if (item.superAdminOnly && !isSuperAdmin) return false;
  if (item.key === "relatorios" && !isSuperAdmin && !canViewReports) return false;
  return DELIVERED_PHASES.includes(item.availableFromPhase);
}

/** view_reports no escopo: na empresa escolhida, ou em qualquer uma no escopo "todas". */
export function scopeCanViewReports(
  scopeSlug: string | null,
  allSlug: string,
  reportSlugs: string[],
): boolean {
  if (!scopeSlug) return false;
  return scopeSlug === allSlug ? reportSlugs.length > 0 : reportSlugs.includes(scopeSlug);
}
