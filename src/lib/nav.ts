import {
  BarChart3,
  CalendarCheck,
  Inbox,
  KanbanSquare,
  Mail,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export const CURRENT_PHASE = 2;

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

export function navHref(item: NavItem, scopeSlug: string): string {
  return item.scoped ? `/${scopeSlug}${item.path}` : item.path;
}

export function isNavItemEnabled(item: NavItem, isSuperAdmin: boolean): boolean {
  if (item.superAdminOnly && !isSuperAdmin) return false;
  return item.availableFromPhase <= CURRENT_PHASE;
}
