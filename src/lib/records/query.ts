import { isUuid } from "@/lib/uuid";
import type { ListQuery } from "./types";

const DEFAULT_SORT = "created_at";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function list(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).map((v) => v.trim()).filter(Boolean))];
}

function date(v: string | null): string | null {
  return v && DATE_RE.test(v) ? v : null;
}

export function parseListQuery(params: URLSearchParams, allowedSorts: string[]): ListQuery {
  const rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawSort = params.get("sort") ?? "";
  const sort = allowedSorts.includes(rawSort) ? rawSort : DEFAULT_SORT;
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  return {
    q: (params.get("q") ?? "").trim(),
    page,
    sort,
    dir,
    // responsáveis e etiquetas são ids: valor que não é uuid é descartado
    owner: list(params, "owner").filter(isUuid),
    label: list(params, "label").filter(isUuid),
    status: list(params, "status"),
    source: list(params, "source"),
    createdFrom: date(params.get("createdFrom")),
    createdTo: date(params.get("createdTo")),
  };
}

/** Omite os valores padrão; "" quando nada foi alterado. */
export function serializeListQuery(q: ListQuery): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.page > 1) p.set("page", String(q.page));
  if (q.sort !== DEFAULT_SORT) p.set("sort", q.sort);
  if (q.dir !== "desc") p.set("dir", q.dir);
  for (const key of ["owner", "label", "status", "source"] as const) {
    for (const v of q[key]) p.append(key, v);
  }
  if (q.createdFrom) p.set("createdFrom", q.createdFrom);
  if (q.createdTo) p.set("createdTo", q.createdTo);
  return p.toString();
}
