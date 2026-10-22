import { parseListQuery } from "@/lib/records/query";
import type { DealListQuery } from "./queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (params: URLSearchParams, key: string) => [
  ...new Set(params.getAll(key).map((v) => v.trim()).filter((v) => UUID.test(v))),
];

/** `parseListQuery` + funil, etapas, equipes e esfriando; ids que não são uuid são descartados. */
export function parseDealListQuery(params: URLSearchParams, allowedSorts: string[]): Required<DealListQuery> {
  const base = parseListQuery(params, allowedSorts);
  const pipeline = params.get("pipeline")?.trim() ?? "";
  return {
    ...base,
    owner: base.owner.filter((v) => UUID.test(v)),
    label: base.label.filter((v) => UUID.test(v)),
    pipeline: UUID.test(pipeline) ? pipeline : null,
    stage: uuids(params, "stage"),
    team: uuids(params, "team"),
    rotting: params.get("rotting") === "1",
  };
}
