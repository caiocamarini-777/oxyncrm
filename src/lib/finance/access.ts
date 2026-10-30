export type FinanceAccess = { view: boolean; manage: boolean; sell: boolean };
export type FinanceAccessRow = { company_id: string; can_view: boolean; can_manage: boolean; can_sell: boolean };

/** Linhas de fin_my_companies → mapa empresa → acesso. */
export function accessMapFromRows(rows: FinanceAccessRow[]): Map<string, FinanceAccess> {
  return new Map(rows.map((r) => [r.company_id, { view: r.can_view === true, manage: r.can_manage === true, sell: r.can_sell === true }]));
}

/** Slugs (na ordem das empresas) em que o usuário tem a permissão pedida. */
export function slugsWithAccess(
  companies: { id: string; slug: string }[],
  access: Map<string, FinanceAccess>,
  action: keyof FinanceAccess,
): string[] {
  return companies.filter((c) => access.get(c.id)?.[action] === true).map((c) => c.slug);
}
