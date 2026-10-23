import { PRESET_FILTER_FIELDS, type Chart, type PresetFilterField, type PresetKey } from "./spec";

export type ParamDef = {
  key: string;
  label: string;
  /** `pipeline` = escolha de funil (a tela lista os funis); `select` = opções fixas. */
  type: "pipeline" | "select";
  required: boolean;
  options?: { value: string; label: string }[];
};

export type Preset = {
  key: PresetKey;
  name: string;
  description: string;
  chart: Chart;
  params: ParamDef[];
  /** Filtros comuns aceitos pelo relatório. */
  filters: PresetFilterField[];
  /** Respeita o período escolhido? Retratos do momento ignoram. */
  usesPeriod: boolean;
};

type Def = Omit<Preset, "filters">;

const DEFS: Def[] = [
  {
    key: "channel_funnel",
    name: "Funil por canal",
    description: "Tentativas, reuniões agendadas e realizadas, oportunidades e ganhos de cada canal.",
    chart: "table",
    params: [],
    usesPeriod: true,
  },
  {
    key: "channel_success",
    name: "Sucesso por canal",
    description: "Atividades concluídas por canal, separadas pela classificação do resultado.",
    chart: "bar",
    params: [],
    usesPeriod: true,
  },
  {
    key: "conversion_influence",
    name: "Influência na conversão",
    description: "Canal da última atividade antes de cada conversão de lead, avanço de etapa e ganho.",
    chart: "bar",
    params: [],
    usesPeriod: true,
  },
  {
    key: "stage_conversion",
    name: "Conversão por etapa",
    description: "Quantos negócios entraram e avançaram em cada etapa de um funil.",
    chart: "funnel",
    params: [
      { key: "pipeline", label: "Funil", type: "pipeline", required: true },
      {
        key: "group_by",
        label: "Agrupar por",
        type: "select",
        required: false,
        options: [
          { value: "owner", label: "Responsável" },
          { value: "month", label: "Mês" },
        ],
      },
    ],
    usesPeriod: true,
  },
  {
    key: "forecast",
    name: "Forecast",
    description: "Negócios abertos por mês de fechamento previsto, comparados ao valor realizado.",
    chart: "bar",
    params: [],
    usesPeriod: true,
  },
  {
    key: "revenue_monthly",
    name: "Receita mês a mês",
    description: "Setup e MRR contratados e previstos em cada mês.",
    chart: "line",
    params: [],
    usesPeriod: true,
  },
  {
    key: "pipeline_overview",
    name: "Visão do funil",
    description: "Negócios abertos por funil e etapa, em quantidade e valor, no momento atual.",
    chart: "table",
    params: [],
    usesPeriod: false,
  },
  {
    key: "aging",
    name: "Tempo parado",
    description: "Leads e negócios abertos, do mais antigo ao mais novo, com dias desde a criação e na etapa.",
    chart: "table",
    params: [],
    usesPeriod: false,
  },
  {
    key: "activities_by_user",
    name: "Atividades por usuário",
    description: "Atividades concluídas no período, atrasadas e abertas de cada responsável.",
    chart: "bar",
    params: [],
    usesPeriod: true,
  },
  {
    key: "lost_reasons",
    name: "Motivos de perda",
    description: "Negócios perdidos no período por motivo, com quantidade e valor.",
    chart: "pie",
    params: [],
    usesPeriod: true,
  },
  {
    key: "goal_progress",
    name: "Progresso das metas",
    description: "Meta, realizado e porcentagem de cada meta no período corrente.",
    chart: "table",
    params: [],
    usesPeriod: false,
  },
];

export const PRESETS: Preset[] = DEFS.map((d) => ({ ...d, filters: PRESET_FILTER_FIELDS[d.key] }));

export function getPreset(key: string): Preset | undefined {
  return PRESETS.find((p) => p.key === key);
}
