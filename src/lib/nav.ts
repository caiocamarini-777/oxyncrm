import {
  BarChart3,
  CalendarCheck,
  Inbox,
  KanbanSquare,
  Mail,
  Receipt,
  Settings,
  Trash2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Fases entregues; E-mail (fase 5) continua desativado. */
export const DELIVERED_PHASES = [1, 2, 3, 4, 6, 8];

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
  { key: "financeiro", label: "Financeiro", icon: Wallet, path: "/financeiro", availableFromPhase: 8, scoped: true },
  { key: "vendas", label: "Vendas", icon: Receipt, path: "/vendas", availableFromPhase: 8, scoped: true },
  { key: "configuracoes", label: "Configurações", icon: Settings, path: "/configuracoes/empresas", availableFromPhase: 1, superAdminOnly: true, scoped: false },
];

/** Destinos que aparecem só na busca (não no menu lateral). */
export const PALETTE_EXTRA_ITEMS: NavItem[] = [
  { key: "lixeira", label: "Lixeira", icon: Trash2, path: "/lixeira", availableFromPhase: 2, scoped: true },
];

/** Acesso ao menu Relatórios: view_reports no escopo e se há dashboards compartilhados comigo. */
export type ReportsNavAccess = {
  canViewReports: boolean;
  hasSharedDashboards: boolean;
  /** view_finance na empresa do escopo (nunca no escopo "todas"); ausente conta como falso. */
  canViewFinance?: boolean;
  /** Pode registrar vendas de clientes (register_sales) na empresa do escopo; ausente conta como falso. */
  canSell?: boolean;
};

/** Sem view_reports (e sem ser admin geral), mas com dashboards compartilhados: Relatórios leva só a eles. */
export function reportsSharedOnly(isSuperAdmin: boolean, access?: ReportsNavAccess): boolean {
  return !isSuperAdmin && !access?.canViewReports && !!access?.hasSharedDashboards;
}

export function navHref(item: NavItem, scopeSlug: string, sharedDashboardsOnly = false): string {
  if (item.key === "relatorios" && sharedDashboardsOnly) return `/${scopeSlug}/relatorios/dashboards`;
  return item.scoped ? `/${scopeSlug}${item.path}` : item.path;
}

/**
 * Relatórios exigem view_reports (ou admin geral), ou dashboards compartilhados comigo (aí o item leva aos
 * dashboards); o resto depende só da fase.
 */
export function isNavItemEnabled(item: NavItem, isSuperAdmin: boolean, access?: ReportsNavAccess): boolean {
  if (item.superAdminOnly && !isSuperAdmin) return false;
  if (item.key === "relatorios" && !isSuperAdmin && !access?.canViewReports && !access?.hasSharedDashboards) {
    return false;
  }
  // Financeiro depende de ativação por empresa e de permissão: nem o admin geral o vê sem isso.
  if (item.key === "financeiro" && !access?.canViewFinance) return false;
  if (item.key === "vendas" && !access?.canSell) return false;
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

/** register_sales só vale com uma empresa escolhida, como o Financeiro. */
export const scopeCanSell = scopeCanViewFinance;

/** view_finance só vale com uma empresa escolhida: no escopo "todas" o Financeiro não existe. */
export function scopeCanViewFinance(
  scopeSlug: string | null,
  allSlug: string,
  financeSlugs: string[],
): boolean {
  if (!scopeSlug || scopeSlug === allSlug) return false;
  return financeSlugs.includes(scopeSlug);
}
