// Casamento de nomes da planilha com cadastros (categorias e organizações), ignorando acentos,
// maiúsculas, espaços e pontuação.

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Categorias de despesa semeadas (fin_seed_categories) e a natureza padrão de cada uma. */
export const SEED_EXPENSE_CATEGORIES: Record<string, "fixed" | "variable"> = {
  "Aquisição de clientes": "variable",
  "Pró-labore": "fixed",
  Pessoas: "fixed",
  Comissão: "variable",
  "Escritório/administração geral": "fixed",
  "Custo de mercadorias/custo de serviços": "variable",
  Viagens: "variable",
  "Despesas jurídicas": "variable",
  Seguros: "fixed",
  Tecnologia: "fixed",
  Repasses: "variable",
  "Impostos/taxas bancárias": "variable",
};

export const SEED_INCOME_CATEGORIES = ["Vendas", "Comissão", "Repasses", "Investimentos/rendimentos"];

/** Grafias da planilha que não casam só pela normalização. */
const ALIASES: Record<string, string> = {
  comissaso: "Comissão", // erro de digitação na aba Despesas
  investimentos: "Investimentos/rendimentos",
};

/** Casa um nome da planilha com uma das opções (pela normalização ou pelos apelidos). */
export function matchCategory(name: string, options: readonly string[]): string | null {
  const n = normalizeName(name);
  const direct = options.find((o) => normalizeName(o) === n);
  if (direct) return direct;
  const alias = ALIASES[n];
  return alias && options.includes(alias) ? alias : null;
}

/**
 * Casa o nome de uma linha da planilha com uma organização: igual (normalizado) ou a organização é
 * prefixo do nome da linha ("Harpix" para "Harpix CRO"). Entre prefixos, vence o mais longo.
 */
export function matchOrganization<T extends { name: string }>(lineName: string, orgs: readonly T[]): T | null {
  const n = normalizeName(lineName);
  let best: T | null = null;
  let bestLen = 0;
  for (const o of orgs) {
    const on = normalizeName(o.name);
    if (!on) continue;
    if (on === n) return o;
    if (n.startsWith(on) && on.length > bestLen) {
      best = o;
      bestLen = on.length;
    }
  }
  return best;
}
