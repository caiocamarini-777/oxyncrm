import { describe, expect, it } from "vitest";
import {
  CALENDAR_SCOPE,
  callbackRedirectUri,
  decideMailbox,
  gmailErrorMessage,
  GMAIL_ERROR_MESSAGES,
  hasCalendarScope,
  hasMeetScopes,
  needsGoogleReconnect,
  hasRequiredScopes,
  MEET_SCOPES,
  REQUIRED_GMAIL_SCOPES,
  parseOauthCookie,
  profileRedirectPath,
  serializeOauthCookie,
  stateMatches,
} from "./connect";

const COMPANY = "0b9f6a3e-6f7c-4a1e-9a55-2d3c4b5a6e7f";
const STATE = "abcdefghijklmnopqrstuvwxyz012345";

describe("cookie do OAuth", () => {
  it("ida e volta", () => {
    expect(parseOauthCookie(serializeOauthCookie({ state: STATE, companyId: COMPANY }))).toEqual({
      state: STATE,
      companyId: COMPANY,
    });
  });

  it("recusa ausente, JSON inválido e formato errado", () => {
    expect(parseOauthCookie(undefined)).toBeNull();
    expect(parseOauthCookie("")).toBeNull();
    expect(parseOauthCookie("{nao-json")).toBeNull();
    expect(parseOauthCookie("null")).toBeNull();
    expect(parseOauthCookie("[]")).toBeNull();
    expect(parseOauthCookie(JSON.stringify({ state: STATE }))).toBeNull();
    expect(parseOauthCookie(JSON.stringify({ state: STATE, companyId: "nao-uuid" }))).toBeNull();
    expect(parseOauthCookie(JSON.stringify({ state: "curto", companyId: COMPANY }))).toBeNull();
    expect(parseOauthCookie(JSON.stringify({ state: 123, companyId: COMPANY }))).toBeNull();
  });
});

describe("stateMatches", () => {
  it("só aceita igual", () => {
    expect(stateMatches(STATE, STATE)).toBe(true);
    expect(stateMatches(STATE, STATE + "x")).toBe(false);
    expect(stateMatches(STATE, "x".repeat(STATE.length))).toBe(false);
    expect(stateMatches(STATE, "")).toBe(false);
    expect(stateMatches(STATE, null)).toBe(false);
  });
});

describe("callbackRedirectUri", () => {
  it("prefere o site configurado e tira a barra final", () => {
    expect(callbackRedirectUri("https://crm.oxyngroup.com.br/", "http://localhost:3001")).toBe(
      "https://crm.oxyngroup.com.br/api/google/callback",
    );
  });
  it("cai na origem da requisição", () => {
    expect(callbackRedirectUri(undefined, "http://localhost:3001")).toBe("http://localhost:3001/api/google/callback");
    expect(callbackRedirectUri("  ", "http://localhost:3001")).toBe("http://localhost:3001/api/google/callback");
  });
});

describe("mensagens de erro", () => {
  it("todo motivo tem texto em português", () => {
    for (const k of Object.keys(GMAIL_ERROR_MESSAGES)) expect(gmailErrorMessage(k)).toBe(GMAIL_ERROR_MESSAGES[k as keyof typeof GMAIL_ERROR_MESSAGES]);
  });
  it("motivo desconhecido ou herdado do prototype vira falha", () => {
    expect(gmailErrorMessage("qualquer")).toBe(GMAIL_ERROR_MESSAGES.falha);
    expect(gmailErrorMessage("toString")).toBe(GMAIL_ERROR_MESSAGES.falha);
    expect(gmailErrorMessage(null)).toBe(GMAIL_ERROR_MESSAGES.falha);
  });
});

describe("profileRedirectPath", () => {
  it("monta sucesso e erro", () => {
    expect(profileRedirectPath({ ok: true })).toBe("/perfil?gmail=ok");
    expect(profileRedirectPath({ ok: false, reason: "sem_refresh_token" })).toBe(
      "/perfil?gmail=erro&motivo=sem_refresh_token",
    );
  });
});

describe("decideMailbox", () => {
  it("caixa de outro usuário é recusada, mesmo com refresh token", () => {
    expect(decideMailbox({ id: "a", user_id: "outro", company_id: "c1" }, "eu", "c1", true)).toEqual({
      kind: "reject",
      reason: "caixa_de_outro_usuario",
    });
  });
  it("do mesmo usuário e empresa atualiza, com ou sem refresh token", () => {
    const mine = { id: "a", user_id: "eu", company_id: "c1" };
    expect(decideMailbox(mine, "eu", "c1", true)).toEqual({ kind: "update", accountId: "a" });
    expect(decideMailbox(mine, "eu", "c1", false)).toEqual({ kind: "update", accountId: "a" });
  });
  it("do mesmo usuário em outra empresa é recusada (desconectar antes)", () => {
    expect(decideMailbox({ id: "a", user_id: "eu", company_id: "c1" }, "eu", "c2", true)).toEqual({
      kind: "reject",
      reason: "caixa_em_outra_empresa",
    });
    expect(gmailErrorMessage("caixa_em_outra_empresa")).toMatch(/outra empresa/);
  });
  it("conta nova sem refresh token é erro; com, cria", () => {
    expect(decideMailbox(null, "eu", "c1", false)).toEqual({ kind: "reject", reason: "sem_refresh_token" });
    expect(decideMailbox(null, "eu", "c1", true)).toEqual({ kind: "create" });
  });
});

describe("hasRequiredScopes", () => {
  const read = "https://www.googleapis.com/auth/gmail.readonly";
  const send = "https://www.googleapis.com/auth/gmail.send";
  it("exige ler e enviar", () => {
    expect(hasRequiredScopes(["openid", "email", read, send])).toBe(true);
    expect(hasRequiredScopes(["openid", "email", read])).toBe(false);
    expect(hasRequiredScopes([send])).toBe(false);
    expect(hasRequiredScopes([])).toBe(false);
    expect(gmailErrorMessage("escopos_incompletos")).toMatch(/ler e enviar/);
  });
});

describe("hasMeetScopes", () => {
  it("exige os três escopos do assistente", () => {
    expect(MEET_SCOPES).toEqual([
      "https://www.googleapis.com/auth/meetings.space.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/drive.meet.readonly",
    ]);
    expect(hasMeetScopes([...REQUIRED_GMAIL_SCOPES, ...MEET_SCOPES])).toBe(true);
    expect(hasMeetScopes(REQUIRED_GMAIL_SCOPES)).toBe(false);
    expect(hasMeetScopes([...REQUIRED_GMAIL_SCOPES, MEET_SCOPES[0]])).toBe(false);
    // Conectada antes das anotações do Gemini: falta o escopo do Drive, precisa reconectar.
    expect(hasMeetScopes([...REQUIRED_GMAIL_SCOPES, MEET_SCOPES[0], MEET_SCOPES[1]])).toBe(false);
    expect(hasMeetScopes([])).toBe(false);
  });

  it("aceita o escopo de leitura da Agenda das caixas conectadas antes (o assistente só lê)", () => {
    const readonly = "https://www.googleapis.com/auth/calendar.events.readonly";
    expect(hasMeetScopes([...REQUIRED_GMAIL_SCOPES, MEET_SCOPES[0], readonly, MEET_SCOPES[2]])).toBe(true);
    // Sem nenhum dos dois escopos da Agenda, falta acesso.
    expect(hasMeetScopes([...REQUIRED_GMAIL_SCOPES, MEET_SCOPES[0], MEET_SCOPES[2]])).toBe(false);
    // O readonly não serve à sincronização com a Agenda.
    expect(hasCalendarScope([...REQUIRED_GMAIL_SCOPES, MEET_SCOPES[0], readonly, MEET_SCOPES[2]])).toBe(false);
  });
});

describe("hasCalendarScope", () => {
  it("é o escopo de leitura e gravação de eventos, o mesmo que o assistente pede", () => {
    expect(CALENDAR_SCOPE).toBe("https://www.googleapis.com/auth/calendar.events");
    expect(MEET_SCOPES).toContain(CALENDAR_SCOPE);
  });

  it("exige o escopo de gravação: o readonly antigo não basta", () => {
    expect(hasCalendarScope([...REQUIRED_GMAIL_SCOPES, CALENDAR_SCOPE])).toBe(true);
    expect(hasCalendarScope([...REQUIRED_GMAIL_SCOPES, "https://www.googleapis.com/auth/calendar.events.readonly"])).toBe(false);
    expect(hasCalendarScope(REQUIRED_GMAIL_SCOPES)).toBe(false);
    expect(hasCalendarScope([])).toBe(false);
    expect(hasCalendarScope(null)).toBe(false);
  });
});

describe("needsGoogleReconnect", () => {
  const readonly = "https://www.googleapis.com/auth/calendar.events.readonly";
  const old = [...REQUIRED_GMAIL_SCOPES, MEET_SCOPES[0], readonly, MEET_SCOPES[2]];
  const full = [...REQUIRED_GMAIL_SCOPES, ...MEET_SCOPES];

  it("caixa antiga (readonly): o assistente segue; a Agenda ligada pede reconexão", () => {
    expect(needsGoogleReconnect(old, { meet: true, calendar: false })).toBe(false);
    expect(needsGoogleReconnect(old, { meet: false, calendar: true })).toBe(true);
    expect(needsGoogleReconnect(old, { meet: true, calendar: true })).toBe(true);
  });

  it("sem os escopos do Meet, pede reconexão só com o assistente ligado", () => {
    expect(needsGoogleReconnect(REQUIRED_GMAIL_SCOPES, { meet: true, calendar: false })).toBe(true);
    expect(needsGoogleReconnect(REQUIRED_GMAIL_SCOPES, { meet: false, calendar: false })).toBe(false);
  });

  it("caixa com todos os escopos nunca pede", () => {
    expect(needsGoogleReconnect(full, { meet: true, calendar: true })).toBe(false);
  });
});
