import "server-only";
import {
  GmailApiError,
  GmailAuthError,
  GmailNetworkError,
  GmailRateLimitError,
  type TokenRequest,
} from "@/lib/gmail/client";

export type GoogleQuery = Record<string, string | number | boolean | undefined>;

export type GoogleInit = { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown };

type ApiErrorBody = { error?: { code?: number; message?: string; status?: string; errors?: { reason?: string }[] } };

export async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** `fetch` que transforma falha de rede (o `fetch` lança `TypeError`) em `GmailNetworkError`, como no cliente do Gmail. */
async function http(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof TypeError) throw new GmailNetworkError(e.message || undefined);
    throw e;
  }
}

export function buildUrl(base: string, path: string, query?: GoogleQuery): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === "") continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/** Motivos do 403 que são limite de uso (passageiro: adiar), e não falta de permissão. */
const RATE_LIMIT_REASONS = ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"];

export function isRateLimit(status: number, body: ApiErrorBody | null): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const reasons = body?.error?.errors?.map((e) => e.reason) ?? [];
  return reasons.some((r) => r !== undefined && RATE_LIMIT_REASONS.includes(r)) || body?.error?.status === "RESOURCE_EXHAUSTED";
}

/**
 * Chamada ao Google com o token da caixa; renova uma vez após 401 (`getAccessToken` é chamado com `forceRefresh` e o
 * token recusado em `rejected`). Devolve a resposta 2xx ou lança o erro do Google. O corpo, quando houver, vai como JSON.
 */
export async function googleSend(
  getAccessToken: (opts?: TokenRequest) => Promise<string>,
  url: string,
  init: GoogleInit = {},
): Promise<Response> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  let token = await getAccessToken();
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (payload !== undefined) headers["Content-Type"] = "application/json";
    const res = await http(url, {
      method: init.method ?? "GET",
      headers,
      ...(payload !== undefined ? { body: payload } : {}),
    });
    if (res.ok) return res;
    if (res.status === 401) {
      if (attempt === 0) {
        token = await getAccessToken({ forceRefresh: true, rejected: token });
        continue;
      }
      throw new GmailAuthError("O Google recusou o token renovado");
    }
    const body = await readJson<ApiErrorBody>(res);
    if (isRateLimit(res.status, body)) throw new GmailRateLimitError(body?.error?.message);
    throw new GmailApiError(res.status, body?.error?.message ?? `O Google respondeu ${res.status}`);
  }
}

/**
 * Como `googleSend`, devolvendo o JSON da resposta. 204 e DELETE devolvem `null`; 2xx sem JSON legível (resposta
 * cortada no meio) é falha de rede, não erro do recurso.
 */
export async function googleRequest<T>(
  getAccessToken: (opts?: TokenRequest) => Promise<string>,
  url: string,
  init?: GoogleInit,
): Promise<T | null> {
  const res = await googleSend(getAccessToken, url, init);
  if (res.status === 204 || init?.method === "DELETE") return null;
  const body = await readJson<T>(res);
  if (body === null) throw new GmailNetworkError("Resposta incompleta do Google");
  return body;
}
