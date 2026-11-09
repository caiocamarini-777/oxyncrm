import { timingSafeEqual } from "node:crypto";

// Funções puras do fluxo de conexão da caixa (OAuth). Sem acesso a banco nem a rede.

export const OAUTH_COOKIE = "gmail_oauth";
export const OAUTH_COOKIE_MAX_AGE = 10 * 60; // 10 min, em segundos
/** O cookie só precisa ir para as rotas do OAuth. */
export const OAUTH_COOKIE_PATH = "/api/google";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type OauthCookie = { state: string; companyId: string };

export function serializeOauthCookie(c: OauthCookie): string {
  return JSON.stringify({ state: c.state, companyId: c.companyId });
}

/** null se faltar, não for JSON, ou o conteúdo não tiver o formato esperado. */
export function parseOauthCookie(raw: string | null | undefined): OauthCookie | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const { state, companyId } = v as Record<string, unknown>;
  if (typeof state !== "string" || state.length < 16 || state.length > 200) return null;
  if (!isUuid(companyId)) return null;
  return { state, companyId };
}

/** Compara o `state` do cookie com o da URL em tempo constante. */
export function stateMatches(expected: string, received: string | null | undefined): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** `${NEXT_PUBLIC_SITE_URL ou origin}/api/google/callback`. Precisa ser idêntico na ida e na volta. */
export function callbackRedirectUri(siteUrl: string | undefined, origin: string): string {
  const base = (siteUrl?.trim() || origin).replace(/\/+$/, "");
  return `${base}/api/google/callback`;
}

export const GMAIL_ERROR_MESSAGES = {
  state_invalido: "A conexão expirou ou não pôde ser confirmada. Tente conectar de novo.",
  acesso_negado: "Você cancelou a autorização no Google. Para conectar o Gmail, é preciso permitir o acesso.",
  caixa_de_outro_usuario: "Esta caixa já está conectada à conta de outra pessoa no CRM.",
  caixa_em_outra_empresa: "Esta caixa já está ligada a outra empresa. Desconecte antes de mudar.",
  escopos_incompletos: "Autorize ler e enviar e-mails para conectar a caixa.",
  sem_refresh_token:
    "O Google não liberou o acesso contínuo à caixa. Remova o acesso do Oxyn CRM em myaccount.google.com/permissions e conecte de novo.",
  nao_configurado: "Integração com o Gmail ainda não configurada.",
  falha: "Não foi possível conectar o Gmail agora. Tente novamente.",
} as const;

export type GmailErrorReason = keyof typeof GMAIL_ERROR_MESSAGES;

/** Motivo desconhecido (ou ausente) cai em `falha`. */
export function gmailErrorMessage(reason: string | null | undefined): string {
  if (reason && Object.hasOwn(GMAIL_ERROR_MESSAGES, reason)) return GMAIL_ERROR_MESSAGES[reason as GmailErrorReason];
  return GMAIL_ERROR_MESSAGES.falha;
}

export function profileRedirectPath(result: { ok: true } | { ok: false; reason: GmailErrorReason }): string {
  return result.ok ? "/perfil?gmail=ok" : `/perfil?gmail=erro&motivo=${result.reason}`;
}

/** Escopos sem os quais a caixa não funciona (ler e enviar). */
export const REQUIRED_GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

/** O usuário pode desmarcar escopos na tela do Google: sem ler e enviar, a caixa não é conectada. */
export function hasRequiredScopes(granted: string[]): boolean {
  return REQUIRED_GMAIL_SCOPES.every((s) => granted.includes(s));
}

/**
 * Escopos do assistente de reuniões: ler as reuniões no Meet, os eventos da agenda e os arquivos que o Meet cria
 * no Drive (as anotações do Gemini). Sem eles a caixa funciona, o assistente não.
 */
export const MEET_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/drive.meet.readonly",
];

/** Contas conectadas antes do assistente (ou com os escopos desmarcados) precisam reconectar. */
export function hasMeetScopes(granted: string[]): boolean {
  return MEET_SCOPES.every((s) => granted.includes(s));
}

export type MailboxDecision =
  | { kind: "create" }
  | { kind: "update"; accountId: string }
  | { kind: "reject"; reason: "caixa_de_outro_usuario" | "caixa_em_outra_empresa" | "sem_refresh_token" };

/**
 * Regra de caixa já ligada: de outro usuário recusa; do mesmo usuário em outra empresa também recusa
 * (mudar de empresa exige desconectar, para as conversas salvas não mudarem de empresa); do mesmo usuário
 * e empresa atualiza (o refresh token antigo continua valendo se o Google não mandou outro); nova exige
 * refresh token.
 */
export function decideMailbox(
  existing: { id: string; user_id: string; company_id: string } | null,
  userId: string,
  companyId: string,
  hasRefreshToken: boolean,
): MailboxDecision {
  if (existing) {
    if (existing.user_id !== userId) return { kind: "reject", reason: "caixa_de_outro_usuario" };
    if (existing.company_id !== companyId) return { kind: "reject", reason: "caixa_em_outra_empresa" };
    return { kind: "update", accountId: existing.id };
  }
  if (!hasRefreshToken) return { kind: "reject", reason: "sem_refresh_token" };
  return { kind: "create" };
}
