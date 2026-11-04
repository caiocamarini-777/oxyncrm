import "server-only";
import { gmailConfig } from "./oauth";
import type { GmailMessage } from "./parse";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Token inválido, revogado ou expirado sem como renovar: a caixa precisa ser reconectada. */
export class GmailAuthError extends Error {
  constructor(message = "Autorização do Gmail inválida ou revogada") {
    super(message);
    this.name = "GmailAuthError";
  }
}

/** Limite de uso do Gmail (429 ou 403 rateLimitExceeded). A conta retoma na próxima execução. */
export class GmailRateLimitError extends Error {
  constructor(message = "Limite de uso do Gmail atingido") {
    super(message);
    this.name = "GmailRateLimitError";
  }
}

/** O history_id guardado é antigo demais para o Gmail (404 em history.list). */
export class GmailHistoryExpiredError extends Error {
  constructor(message = "Histórico do Gmail expirado") {
    super(message);
    this.name = "GmailHistoryExpiredError";
  }
}

export class GmailApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

export type TokenSet = { accessToken: string; refreshToken: string | null; expiresAt: Date };

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function requireConfig() {
  const cfg = gmailConfig();
  if (!cfg) throw new Error("Integração com o Gmail não configurada");
  return cfg;
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function postToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await readJson<TokenResponse>(res)) ?? {};
  if (!res.ok) {
    if (body.error === "invalid_grant") {
      throw new GmailAuthError(body.error_description ?? "invalid_grant");
    }
    if (res.status === 429) throw new GmailRateLimitError();
    throw new GmailApiError(res.status, body.error_description ?? body.error ?? `Falha no token (${res.status})`);
  }
  if (!body.access_token) throw new GmailApiError(res.status, "Resposta do Google sem access_token");
  return body;
}

function expiryOf(body: TokenResponse): Date {
  return new Date(Date.now() + (body.expires_in ?? 3600) * 1000);
}

/** Troca o code do OAuth por tokens. `refreshToken` pode vir null se o Google não o reenviar. */
export async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const cfg = requireConfig();
  const body = await postToken({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  return { accessToken: body.access_token!, refreshToken: body.refresh_token ?? null, expiresAt: expiryOf(body) };
}

/** Renova o access token. `invalid_grant` lança GmailAuthError. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const cfg = requireConfig();
  const body = await postToken({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  });
  return { accessToken: body.access_token!, expiresAt: expiryOf(body) };
}

/** Revoga o token no Google. Melhor esforço: nunca lança; devolve se o Google aceitou. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type GmailProfile = { emailAddress: string; historyId: string; messagesTotal?: number; threadsTotal?: number };
export type MessageRef = { id: string; threadId: string };
export type HistoryRecord = { id?: string; messagesAdded?: { message: MessageRef }[] };
export type ThreadSummary = { id: string; snippet?: string; historyId?: string };
export type GmailThread = { id: string; historyId?: string; messages?: GmailMessage[] };

const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "Date", "Message-ID"];

type Query = Record<string, string | number | string[] | undefined>;

function buildUrl(path: string, query?: Query): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, String(v));
  }
  const qs = p.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
}

type ApiErrorBody = { error?: { code?: number; message?: string; status?: string; errors?: { reason?: string }[] } };

function isRateLimit(status: number, body: ApiErrorBody | null): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const reasons = body?.error?.errors?.map((e) => e.reason) ?? [];
  return (
    reasons.includes("rateLimitExceeded") ||
    reasons.includes("userRateLimitExceeded") ||
    body?.error?.status === "RESOURCE_EXHAUSTED"
  );
}

/**
 * Cliente REST do Gmail. `getAccessToken` devolve o token vigente; com `forceRefresh`
 * deve renovar mesmo que o token pareça válido (usado após um 401).
 */
export class GmailClient {
  constructor(private readonly getAccessToken: (opts?: { forceRefresh?: boolean }) => Promise<string>) {}

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Query; json?: unknown; historyCall?: boolean } = {},
  ): Promise<T> {
    const url = buildUrl(path, opts.query);
    let token = await this.getAccessToken();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(opts.json !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
      });
      if (res.ok) return (await readJson<T>(res)) as T;
      if (res.status === 401) {
        if (attempt === 0) {
          token = await this.getAccessToken({ forceRefresh: true });
          continue;
        }
        throw new GmailAuthError("Gmail recusou o token renovado");
      }
      const body = await readJson<ApiErrorBody>(res);
      if (isRateLimit(res.status, body)) throw new GmailRateLimitError(body?.error?.message);
      if (res.status === 404 && opts.historyCall) throw new GmailHistoryExpiredError();
      throw new GmailApiError(res.status, body?.error?.message ?? `Gmail respondeu ${res.status}`);
    }
  }

  getProfile(): Promise<GmailProfile> {
    return this.request("GET", "/profile");
  }

  async listMessages(opts: { q?: string; pageToken?: string; maxResults?: number }): Promise<{
    messages: MessageRef[];
    nextPageToken?: string;
  }> {
    const r = await this.request<{ messages?: MessageRef[]; nextPageToken?: string }>("GET", "/messages", {
      query: { q: opts.q, pageToken: opts.pageToken, maxResults: opts.maxResults },
    });
    return { messages: r.messages ?? [], nextPageToken: r.nextPageToken };
  }

  getMessage(id: string, format: "metadata" | "full"): Promise<GmailMessage> {
    return this.request("GET", `/messages/${encodeURIComponent(id)}`, {
      query: { format, metadataHeaders: format === "metadata" ? METADATA_HEADERS : undefined },
    });
  }

  async listHistory(opts: { startHistoryId: string; pageToken?: string }): Promise<{
    history: HistoryRecord[];
    historyId: string;
    nextPageToken?: string;
  }> {
    const r = await this.request<{ history?: HistoryRecord[]; historyId: string; nextPageToken?: string }>(
      "GET",
      "/history",
      {
        query: { startHistoryId: opts.startHistoryId, historyTypes: "messageAdded", pageToken: opts.pageToken },
        historyCall: true,
      },
    );
    return { history: r.history ?? [], historyId: r.historyId, nextPageToken: r.nextPageToken };
  }

  async listThreads(opts: { q?: string; pageToken?: string; maxResults?: number }): Promise<{
    threads: ThreadSummary[];
    nextPageToken?: string;
  }> {
    const r = await this.request<{ threads?: ThreadSummary[]; nextPageToken?: string }>("GET", "/threads", {
      query: { q: opts.q, pageToken: opts.pageToken, maxResults: opts.maxResults ?? 25 },
    });
    return { threads: r.threads ?? [], nextPageToken: r.nextPageToken };
  }

  getThread(id: string, format: "metadata" | "full"): Promise<GmailThread> {
    return this.request("GET", `/threads/${encodeURIComponent(id)}`, {
      query: { format, metadataHeaders: format === "metadata" ? METADATA_HEADERS : undefined },
    });
  }

  /** `raw` é o RFC 822 em base64url. */
  send(raw: string, threadId?: string): Promise<MessageRef> {
    return this.request("POST", "/messages/send", { json: threadId ? { raw, threadId } : { raw } });
  }
}
