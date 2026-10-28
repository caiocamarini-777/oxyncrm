/**
 * Cores dos gráficos. Paleta do sistema: 42 cores, em 3 linhas de 14 tons (claras, médias, escuras), como no
 * diálogo "Personalizar cores" do Pipedrive. Ordem de prioridade de um valor: cor do relatório > cor padrão da
 * empresa > cor semântica do sistema (ganho verde, perdido vermelho...) > cor do cadastro (etiqueta) > paleta.
 */
export const PALETTE_ROWS: string[][] = [
  ["#c7d2fe", "#bae6fd", "#a5f3fc", "#99f6e4", "#bbf7d0", "#d9f99d", "#fef08a", "#fde68a", "#fed7aa", "#fecaca", "#fbcfe8", "#f5d0fe", "#ddd6fe", "#e7e5e4"],
  ["#2a78d6", "#38bdf8", "#22d3ee", "#1baf7a", "#008300", "#a3e635", "#eda100", "#fbbf24", "#eb6834", "#e34948", "#e87ba4", "#e879f9", "#6250d6", "#a8a29e"],
  ["#3730a3", "#0369a1", "#0e7490", "#0f766e", "#15803d", "#4d7c0f", "#a16207", "#b45309", "#c2410c", "#b91c1c", "#be185d", "#a21caf", "#6d28d9", "#57534e"],
];

export const PALETTE: string[] = PALETTE_ROWS.flat();

/** Ordem usada quando nada define a cor: as 8 validadas, depois o resto da paleta. */
export const SERIES_ORDER: string[] = [
  // 8 primeiras: ordem validada para daltonismo (cores vizinhas distinguíveis)
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948",
  ...[...PALETTE_ROWS[1]!, ...PALETTE_ROWS[2]!, ...PALETTE_ROWS[0]!].filter(
    (c) => !["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"].includes(c),
  ),
];

/** Cores semânticas do sistema por campo e valor. */
const SYSTEM: Record<string, string> = {
  "status:open": "#2a78d6",
  "status:won": "#1baf7a",
  "status:lost": "#e34948",
  "status:converted": "#1baf7a",
  "status:disqualified": "#e34948",
  "status:archived": "#a8a29e",
  "done:true": "#1baf7a",
  "done:false": "#2a78d6",
  "overdue:true": "#e34948",
  "overdue:false": "#2a78d6",
  "funnel:reached": "#eda100",
  "funnel:won": "#1baf7a",
  "conversion:converted": "#1baf7a",
  "conversion:other": "#a8a29e",
};

/** Cores das etiquetas do cadastro (nomes fixos do Oxyn). */
const LABEL_COLORS: Record<string, string> = {
  teal: "#2dd4bf",
  blue: "#38bdf8",
  green: "#4ade80",
  red: "#f87171",
  gray: "#a8a29e",
  purple: "#a78bfa",
};

export type ColorContext = {
  /** colors do relatório: chave do valor -> cor */
  report: Record<string, string>;
  /** cores padrão da empresa: "campo:valor" -> cor */
  company: Record<string, string>;
  /** cor do próprio cadastro (ex.: etiqueta), por chave do valor */
  record?: Record<string, string>;
};

export function labelColor(name: string | undefined): string | undefined {
  return name ? LABEL_COLORS[name] ?? (/^#[0-9a-f]{6}$/i.test(name) ? name.toLowerCase() : undefined) : undefined;
}

/** Cor de um valor (field:key) na posição index da série. */
export function resolveColor(field: string, key: string, index: number, ctx: ColorContext): string {
  return (
    ctx.report[key] ??
    ctx.company[`${field}:${key}`] ??
    SYSTEM[`${field}:${key}`] ??
    ctx.record?.[key] ??
    SERIES_ORDER[((index % SERIES_ORDER.length) + SERIES_ORDER.length) % SERIES_ORDER.length]!
  );
}

/** Texto legível sobre a cor (rótulos dentro da barra). */
export function contrastText(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#1c1917" : "#ffffff";
}
