import { parseListQuery } from "@/lib/records/query";
import type { DealListQuery } from "./queries";
import { isUuid } from "@/lib/uuid";

const uuids = (params: URLSearchParams, key: string) => [
  ...new Set(params.getAll(key).map((v) => v.trim()).filter(isUuid)),
];

/** `parseListQuery` + funil, etapas, equipes e esfriando; ids que não são uuid são descartados. */
export function parseDealListQuery(params: URLSearchParams, allowedSorts: string[]): Required<DealListQuery> {
  const base = parseListQuery(params, allowedSorts);
  // `funil` é o parâmetro do seletor da tela; `pipeline` continua aceito.
  const pipeline = (params.get("pipeline") ?? params.get("funil"))?.trim() ?? "";
  return {
    ...base,
    pipeline: isUuid(pipeline) ? pipeline : null,
    stage: uuids(params, "stage"),
    team: uuids(params, "team"),
    rotting: params.get("rotting") === "1",
  };
}

export const DEAL_VIEWS = ["kanban", "lista", "forecast"] as const;
export type DealView = (typeof DEAL_VIEWS)[number];

/** `?visao=`: kanban (padrão), lista ou forecast. */
export function parseDealView(raw: string | null): DealView {
  return (DEAL_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as DealView) : "kanban";
}
