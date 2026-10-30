export type FinanceTab = { key: string; label: string; path: string; manageOnly?: boolean };

/** Abas do Financeiro; `path` é relativo a /<empresa>/financeiro. */
export const FINANCE_TABS: FinanceTab[] = [
  { key: "mes", label: "Mês", path: "" },
  { key: "projecao", label: "Projeção", path: "/projecao" },
  { key: "clientes", label: "Clientes", path: "/clientes" },
  { key: "servicos", label: "Serviços", path: "/servicos" },
  { key: "custos", label: "Custos", path: "/custos" },
  { key: "lancamentos", label: "Lançamentos", path: "/lancamentos" },
  { key: "contratos", label: "Contratos", path: "/contratos" },
  { key: "despesas", label: "Recorrentes", path: "/despesas" },
  { key: "vendas", label: "Vendas", path: "/vendas" },
  { key: "configuracoes", label: "Configurações", path: "/configuracoes", manageOnly: true },
];

/** Hoje em America/Sao_Paulo, 'YYYY-MM-DD'. */
export function todayInSaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}
