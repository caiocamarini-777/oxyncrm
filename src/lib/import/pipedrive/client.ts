import "server-only";
import type { PdPageEntity, PdFieldDef, PdItem, PdPage } from "./types";

export class PipedriveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PipedriveError";
  }
}

export class PipedriveAuthError extends PipedriveError {
  constructor() {
    super("Token do Pipedrive inválido ou sem permissão (401)", 401);
    this.name = "PipedriveAuthError";
  }
}

export type PipedriveClientOptions = {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Espera entre tentativas (injetável nos testes). */
  sleepImpl?: (ms: number) => Promise<void>;
};

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];
const ENTITY_QUERY: Record<PdPageEntity, string> = {
  archivedLeads: "/v1/leads/archived",
  organizations: "/v1/organizations",
  persons: "/v1/persons",
  leads: "/v1/leads",
  deals: "/v1/deals?status=all_not_deleted",
  activities: "/v1/activities?user_id=0",
  notes: "/v1/notes",
  products: "/v1/products",
};

type Envelope = {
  success?: boolean;
  data?: unknown;
  error?: string;
  additional_data?: {
    next_start?: number;
    pagination?: { more_items_in_collection?: boolean; next_start?: number };
  };
};

function retryAfterMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  const secs = raw === null ? NaN : Number(raw);
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : 0;
}

export function createPipedriveClient(opts: PipedriveClientOptions) {
  const base = (opts.baseUrl ?? "https://api.pipedrive.com").replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** Até 5 novas tentativas (1s, 2s, 4s, 8s, 16s) em 429, 5xx e falha de rede. Nunca inclui headers em erros. */
  async function request(path: string): Promise<Envelope> {
    const url = `${base}${path}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await doFetch(url, { headers: { "x-api-token": opts.token, accept: "application/json" } });
      } catch {
        res = null;
      }
      if (res && res.status === 401) throw new PipedriveAuthError();
      const retryable = res === null || res.status === 429 || res.status >= 500;
      if (res && res.ok) {
        try {
          return (await res.json()) as Envelope;
        } catch {
          throw new PipedriveError(`Resposta inválida do Pipedrive em ${path.split("?")[0]}`, res.status);
        }
      }
      if (!retryable || attempt >= BACKOFF_MS.length) {
        const where = path.split("?")[0];
        throw new PipedriveError(
          res ? `Pipedrive respondeu ${res.status} em ${where}` : `Falha de rede ao chamar o Pipedrive em ${where}`,
          res?.status,
        );
      }
      await sleep(Math.max(BACKOFF_MS[attempt], res ? retryAfterMs(res) : 0));
    }
  }

  async function list<T = PdItem>(path: string): Promise<T[]> {
    const sep = path.includes("?") ? "&" : "?";
    const body = await request(`${path}${sep}limit=500`);
    return Array.isArray(body.data) ? (body.data as T[]) : [];
  }

  return {
    async me(): Promise<PdItem> {
      const body = await request("/v1/users/me");
      return (body.data ?? {}) as PdItem;
    },
    pipelines: () => list("/v1/pipelines"),
    stages: () => list("/v1/stages"),
    users: () => list("/v1/users"),
    activityTypes: () => list("/v1/activityTypes"),
    leadLabels: () => list("/v1/leadLabels"),
    dealFields: () => list<PdFieldDef>("/v1/dealFields"),
    personFields: () => list<PdFieldDef>("/v1/personFields"),
    organizationFields: () => list<PdFieldDef>("/v1/organizationFields"),
    async page(entity: PdPageEntity, start: number, limit = 500): Promise<PdPage> {
      const base0 = ENTITY_QUERY[entity];
      const sep = base0.includes("?") ? "&" : "?";
      const body = await request(`${base0}${sep}start=${start}&limit=${limit}`);
      const pg = body.additional_data?.pagination;
      const more = pg?.more_items_in_collection ?? body.additional_data?.next_start !== undefined;
      const next = pg?.next_start ?? body.additional_data?.next_start;
      return {
        items: Array.isArray(body.data) ? (body.data as PdItem[]) : [],
        nextStart: more && typeof next === "number" ? next : null,
      };
    },
  };
}

export type PipedriveClient = ReturnType<typeof createPipedriveClient>;
