/**
 * Cores dos gráficos. Paleta do sistema: 42 cores, em 3 linhas de 14 tons (claras, médias, escuras), como no
 * diálogo "Personalizar cores" do Pipedrive. Ordem de prioridade de um valor: cor do relatório > cor padrão da
 * empresa > cor semântica do sistema (ganho verde, perdido vermelho...) > cor do cadastro (etiqueta) > paleta.
 */
export const PALETTE_ROWS: string[][] = [
  ["#c7d2fe", "#bae6fd", "#a5f3fc", "#99f6e4", "#bbf7d0", "#d9f99d", "#fef08a", "#fde68a", "#fed7aa", "#fecaca", "#fbcfe8", "#f5d0fe", "#ddd6fe", "#e7e5e4"],
  ["#6366f1", "#38bdf8", "#22d3ee", "#2dd4bf", "#4ade80", "#a3e635", "#facc15", "#fbbf24", "#fb923c", "#f87171", "#f472b6", "#e879f9", "#a78bfa", "#a8a29e"],
  ["#3730a3", "#0369a1", "#0e7490", "#0f766e", "#15803d", "#4d7c0f", "#a16207", "#b45309", "#c2410c", "#b91c1c", "#be185d", "#a21caf", "#6d28d9", "#57534e"],
];

export const PALETTE: string[] = PALETTE_ROWS.flat();

/** Ordem usada quando nada define a cor: azul primeiro (como o "Aberto" do Pipedrive), depois tons contrastantes. */
export const SERIES_ORDER: string[] = [
  "#38bdf8", "#4ade80", "#fb923c", "#a78bfa", "#f87171", "#2dd4bf", "#facc15", "#f472b6", "#6366f1", "#a3e635",
  "#22d3ee", "#e879f9", "#fbbf24", "#a8a29e",
  "#0369a1", "#15803d", "#c2410c", "#6d28d9", "#b91c1c", "#0f766e", "#a16207", "#be185d", "#3730a3", "#4d7c0f",
  "#0e7490", "#a21caf", "#b45309", "#57534e",
  "#bae6fd", "#bbf7d0", "#fed7aa", "#ddd6fe", "#fecaca", "#99f6e4", "#fef08a", "#fbcfe8", "#c7d2fe", "#d9f99d",
  "#a5f3fc", "#f5d0fe", "#fde68a", "#e7e5e4",
];

/** Cores semânticas do sistema por campo e valor. */
const SYSTEM: Record<string, string> = {
  "status:open": "#38bdf8",
  "status:won": "#4ade80",
  "status:lost": "#f87171",
  "status:converted": "#4ade80",
  "status:disqualified": "#f87171",
  "status:archived": "#a8a29e",
  "done:true": "#4ade80",
  "done:false": "#38bdf8",
  "overdue:true": "#f87171",
  "overdue:false": "#38bdf8",
  "funnel:reached": "#facc15",
  "funnel:won": "#4ade80",
  "conversion:converted": "#4ade80",
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
