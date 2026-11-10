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
  /** Relógio (injetável nos testes). */
  nowImpl?: () => number;
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
  error_info?: string;
  additional_data?: {
    next_start?: number;
    pagination?: { more_items_in_collection?: boolean; next_start?: number };
  };
};

const MAX_WAIT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Teto de uma chamada com todas as tentativas e esperas: uma unidade do motor (página) fica bem abaixo da
 * concessão de 120 s do job.
 */
export const REQUEST_TOTAL_MS = 90_000;
/** Download de arquivo: tentativa e teto próprios (arquivos de até 25 MB demoram mais que uma página JSON). */
const DOWNLOAD_TIMEOUT_MS = 120_000;
export const DOWNLOAD_TOTAL_MS = 300_000;
/** Máximo de redirecionamentos seguidos no download (sem o token). */
const MAX_REDIRECTS = 3;

const JSON_MODE: FetchMode = { accept: "application/json", timeoutMs: REQUEST_TIMEOUT_MS, totalMs: REQUEST_TOTAL_MS };
const DOWNLOAD_MODE: FetchMode = {
  accept: "*/*",
  timeoutMs: DOWNLOAD_TIMEOUT_MS,
  totalMs: DOWNLOAD_TOTAL_MS,
  manualRedirect: true,
};

type FetchMode = {
  accept: string;
  /** Teto de cada tentativa. */
  timeoutMs: number;
  /** Teto da chamada inteira, somando tentativas e esperas. */
  totalMs: number;
  /** Método HTTP (GET quando ausente). */
  method?: string;
  /** Corpo já serializado em JSON; manda `content-type: application/json` junto. */
  body?: string;
  /**
   * Escrita não idempotente (POST): só repete no 429 (o pedido foi rejeitado, não processado). 5xx, timeout e falha
   * de rede são ambíguos (o Pipedrive pode ter criado o registro) e lançam na hora, sem nova chamada.
   */
  retryOnly429?: boolean;
  /** Escritas: inclui na mensagem do erro o `error`/`error_info` do envelope da resposta (nunca headers nem token). */
  errorDetail?: boolean;
  /** Trata redirecionamentos à mão, sem repassar o token ao destino. */
  manualRedirect?: boolean;
};

const ERROR_DETAIL_MAX = 300;

/** Retry-After em segundos ou em data HTTP; ms de espera (0 se ausente/inválido). */
export function retryAfterMs(res: Response, now = Date.now()): number {
  const raw = res.headers.get("retry-after")?.trim();
  if (!raw) return 0;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return secs > 0 ? secs * 1000 : 0;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

export function createPipedriveClient(opts: PipedriveClientOptions) {
  const base = (opts.baseUrl ?? "https://api.pipedrive.com").replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.nowImpl ?? Date.now;

  /** Mensagem de erro do envelope (`error` e `error_info`), sem o token, em uma linha e com até 300 caracteres. */
  async function errorDetail(res: Response): Promise<string> {
    try {
      const env = JSON.parse(await res.text()) as Envelope;
      const text = [env?.error, env?.error_info]
        .filter((p): p is string => typeof p === "string" && p.trim() !== "")
        .join(" - ");
      const clean = (opts.token ? text.split(opts.token).join("[token]") : text).replace(/\s+/g, " ").trim();
      return clean.slice(0, ERROR_DETAIL_MAX);
    } catch {
      return "";
    }
  }

  /**
   * Segue à mão o redirecionamento de um download (até MAX_REDIRECTS saltos), SEM o header do token: o destino é
   * outro host (ex.: URL assinada de armazenamento). Devolve a resposta 2xx final; qualquer outra coisa vira
   * PipedriveError só com o caminho, sem token nem URL de destino.
   */
  async function followRedirects(first: Response, fromUrl: string, path: string, mode: FetchMode, deadline: number) {
    const where = path.split("?")[0];
    let cur = first;
    let curUrl = fromUrl;
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const location = cur.headers.get("location");
      await cur.body?.cancel().catch(() => {});
      if (!location) throw new PipedriveError(`Redirecionamento sem destino ao baixar ${where}`, cur.status);
      let next: Response;
      try {
        curUrl = new URL(location, curUrl).toString();
        next = await doFetch(curUrl, {
          headers: { accept: mode.accept },
          redirect: "manual",
          signal: AbortSignal.timeout(Math.max(1, Math.min(mode.timeoutMs, deadline - now()))),
        });
      } catch {
        throw new PipedriveError(`Falha de rede ao baixar o arquivo em ${where}`);
      }
      if (next.status >= 300 && next.status < 400) {
        cur = next;
        continue;
      }
      if (!next.ok) {
        await next.body?.cancel().catch(() => {});
        throw new PipedriveError(`Armazenamento do arquivo respondeu ${next.status} ao baixar ${where}`, next.status);
      }
      return next;
    }
    await cur.body?.cancel().catch(() => {});
    throw new PipedriveError(`Redirecionamentos demais ao baixar ${where}`, cur.status);
  }

  /**
   * Até 5 novas tentativas (1s, 2s, 4s, 8s, 16s) em 429, 5xx e falha de rede, dentro de `mode.totalMs` somando
   * tentativas e esperas (o POST repete só no 429: ver `retryOnly429`). Nunca inclui headers em erros.
   * `mode.method` e `mode.body` (JSON) servem às escritas, e `mode.manualRedirect` ao download; `read` extrai o
   * resultado de uma resposta 2xx (JSON ou bytes) e, se falhar, vira PipedriveError sem nova tentativa.
   */
  async function fetchWithRetry<T>(path: string, mode: FetchMode, read: (res: Response) => Promise<T>): Promise<T> {
    const url = `${base}${path}`;
    const deadline = now() + mode.totalMs;
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await doFetch(url, {
          method: mode.method ?? "GET",
          headers: {
            "x-api-token": opts.token,
            accept: mode.accept,
            ...(mode.body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(mode.body !== undefined ? { body: mode.body } : {}),
          ...(mode.manualRedirect ? { redirect: "manual" as const } : {}),
          signal: AbortSignal.timeout(Math.max(1, Math.min(mode.timeoutMs, deadline - now()))),
        });
      } catch {
        res = null;
      }
      if (res && res.status === 401) {
        await res.body?.cancel().catch(() => {});
        throw new PipedriveAuthError();
      }
      if (res && mode.manualRedirect && res.status >= 300 && res.status < 400) {
        res = await followRedirects(res, url, path, mode, deadline);
      }
      const retryable = mode.retryOnly429
        ? res !== null && res.status === 429
        : res === null || res.status === 429 || res.status >= 500;
      if (res && res.ok) {
        try {
          return await read(res);
        } catch {
          throw new PipedriveError(`Resposta inválida do Pipedrive em ${path.split("?")[0]}`, res.status);
        }
      }
      const wait = attempt < BACKOFF_MS.length
        ? Math.min(MAX_WAIT_MS, Math.max(BACKOFF_MS[attempt], res ? retryAfterMs(res) : 0))
        : 0;
      // sem tempo para esperar e tentar de novo dentro do teto: desiste agora
      const giveUp = !retryable || attempt >= BACKOFF_MS.length || now() + wait >= deadline;
      // ao desistir de uma escrita lê a mensagem do Pipedrive; senão o corpo é descartado (libera a conexão)
      let detail = "";
      if (res) {
        if (giveUp && mode.errorDetail) detail = await errorDetail(res);
        else await res.body?.cancel().catch(() => {});
      }
      if (giveUp) {
        const where = path.split("?")[0];
        throw new PipedriveError(
          res
            ? `Pipedrive respondeu ${res.status} em ${where}${detail ? `: ${detail}` : ""}`
            : `Falha de rede ao chamar o Pipedrive em ${where}`,
          res?.status,
        );
      }
      await sleep(wait);
    }
  }

  function request(path: string): Promise<Envelope> {
    return fetchWithRetry(path, JSON_MODE, async (res) => (await res.json()) as Envelope);
  }

  /**
   * Escrita em JSON (POST/PUT/PATCH) com as esperas e tetos da leitura; devolve o `data` do envelope. PUT e PATCH
   * repetem como a leitura (idempotentes); o POST só repete no 429.
   */
  async function write(method: "POST" | "PUT" | "PATCH", path: string, body: unknown): Promise<unknown> {
    const mode: FetchMode = {
      ...JSON_MODE, method, body: JSON.stringify(body), errorDetail: true, ...(method === "POST" ? { retryOnly429: true } : {}),
    };
    const envelope = await fetchWithRetry(path, mode, async (res) => (await res.json()) as Envelope);
    return envelope.data;
  }

  async function list<T = PdItem>(path: string): Promise<T[]> {
    const sep = path.includes("?") ? "&" : "?";
    const body = await request(`${path}${sep}limit=500`);
    return Array.isArray(body.data) ? (body.data as T[]) : [];
  }

  return {
    post: (path: string, body: unknown): Promise<unknown> => write("POST", path, body),
    put: (path: string, body: unknown): Promise<unknown> => write("PUT", path, body),
    patch: (path: string, body: unknown): Promise<unknown> => write("PATCH", path, body),
    /**
     * DELETE com as mesmas tentativas; 404 e 410 não são erro (o registro já foi apagado). O corpo da resposta é
     * ignorado.
     */
    async del(path: string): Promise<void> {
      try {
        await fetchWithRetry(path, { ...JSON_MODE, method: "DELETE", errorDetail: true }, async (res) => {
          await res.body?.cancel().catch(() => {});
        });
      } catch (e) {
        if (e instanceof PipedriveError && (e.status === 404 || e.status === 410)) return;
        throw e;
      }
    },
    /** GET genérico (caminho com a query). `nextStart` vem da paginação do Pipedrive, ou `null` se não há mais itens. */
    async get(path: string): Promise<{ data: unknown; nextStart: number | null }> {
      const body = await request(path);
      const pg = body.additional_data?.pagination;
      const nextStart = pg?.more_items_in_collection && typeof pg.next_start === "number" ? pg.next_start : null;
      return { data: body.data, nextStart };
    },
    /**
     * Baixa um arquivo (bytes) com as mesmas tentativas e esperas das demais chamadas, mas com tentativa de 120 s e
     * teto de DOWNLOAD_TOTAL_MS. Redirecionamentos são seguidos sem o token (ver followRedirects).
     */
    download(path: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
      return fetchWithRetry(path, DOWNLOAD_MODE, async (res) => ({
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type"),
      }));
    },
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
    activityFields: () => list<PdFieldDef>("/v1/activityFields"),
    async page(entity: PdPageEntity, start: number, limit = 500): Promise<PdPage> {
      const base0 = ENTITY_QUERY[entity];
      const sep = base0.includes("?") ? "&" : "?";
      const body = await request(`${base0}${sep}start=${start}&limit=${limit}`);
      const pg = body.additional_data?.pagination;
      const items = Array.isArray(body.data) ? (body.data as PdItem[]) : [];
      const given = pg?.next_start ?? body.additional_data?.next_start;
      const more = pg?.more_items_in_collection ?? typeof given === "number";
      // sem next_start, segue de onde parou; página vazia encerra (evita laço infinito)
      // next_start que não avança (<= start) também cai no fallback, evitando laço infinito
      const next = typeof given === "number" && given > start ? given : start + items.length;
      return { items, nextStart: more && items.length > 0 ? next : null };
    },
  };
}

export type PipedriveClient = ReturnType<typeof createPipedriveClient>;
