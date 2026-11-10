import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthUrl, GMAIL_SCOPES, gmailConfig, newState } from "./oauth";

afterEach(() => vi.unstubAllEnvs());

describe("buildAuthUrl", () => {
  it("monta a URL com escopos exatos, offline e consentimento", () => {
    const url = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "https://x.com/api/google/callback", state: "st" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.com/api/google/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("scope")).toBe(
      "openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.meet.readonly",
    );
    expect(url.searchParams.get("scope")).toContain("meetings.space.readonly");
    // O escopo de leitura e gravação (a sincronização com a Agenda), e não o `readonly` antigo.
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).not.toContain("calendar.events.readonly");
    expect(url.searchParams.get("scope")).toContain("drive.meet.readonly");
    expect(GMAIL_SCOPES).toHaveLength(7);
  });
});

describe("newState", () => {
  it("tem 32 bytes em base64url e muda a cada chamada", () => {
    const s = newState();
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(s, "base64url")).toHaveLength(32);
    expect(newState()).not.toBe(s);
  });
});

describe("gmailConfig", () => {
  const key = randomBytes(32).toString("base64");

  it("lê o env na chamada, não na importação", () => {
    expect(gmailConfig()).toBeNull();
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GMAIL_TOKEN_KEY", key);
    expect(gmailConfig()).toEqual({ clientId: "id", clientSecret: "secret", tokenKey: key });
  });

  it("devolve null se faltar qualquer variável", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("GMAIL_TOKEN_KEY", key);
    expect(gmailConfig()).toBeNull();
  });

  it("devolve null se a chave não decodificar para 32 bytes", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GMAIL_TOKEN_KEY", randomBytes(16).toString("base64"));
    expect(gmailConfig()).toBeNull();
  });
});
