import { cookies } from "next/headers";
import { connection, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { exchangeCode, GmailClient } from "@/lib/gmail/client";
import {
  callbackRedirectUri,
  hasRequiredScopes,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  parseOauthCookie,
  profileRedirectPath,
  stateMatches,
  type GmailErrorReason,
} from "@/lib/gmail/connect";
import { saveMailbox, userCanUseCompany } from "@/lib/gmail/connect-server";
import { gmailConfig } from "@/lib/gmail/oauth";

/**
 * Volta do Google: confere o `state`, troca o code, confere os escopos concedidos (ler e enviar), descobre
 * o e-mail da caixa e grava a conta.
 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const siteBase = process.env.NEXT_PUBLIC_SITE_URL?.trim() || url.origin;
  const finish = (result: { ok: true } | { ok: false; reason: GmailErrorReason }) => {
    const res = NextResponse.redirect(new URL(profileRedirectPath(result), siteBase));
    res.cookies.set(OAUTH_COOKIE, "", { maxAge: 0, path: OAUTH_COOKIE_PATH });
    return res;
  };

  const profile = await getCurrentProfile();
  if (!profile || !profile.active) {
    const res = NextResponse.redirect(new URL("/entrar", siteBase));
    res.cookies.set(OAUTH_COOKIE, "", { maxAge: 0, path: OAUTH_COOKIE_PATH });
    return res;
  }

  const cfg = gmailConfig();
  if (!cfg) return finish({ ok: false, reason: "nao_configurado" });

  const saved = parseOauthCookie((await cookies()).get(OAUTH_COOKIE)?.value);
  if (!saved || !stateMatches(saved.state, url.searchParams.get("state"))) {
    return finish({ ok: false, reason: "state_invalido" });
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) return finish({ ok: false, reason: oauthError === "access_denied" ? "acesso_negado" : "falha" });
  const code = url.searchParams.get("code");
  if (!code) return finish({ ok: false, reason: "falha" });

  if (!(await userCanUseCompany(saved.companyId))) return finish({ ok: false, reason: "falha" });

  try {
    const tokens = await exchangeCode(code, callbackRedirectUri(process.env.NEXT_PUBLIC_SITE_URL, url.origin));
    // Sem revogar: revogar derrubaria também a autorização de uma conexão anterior que funciona.
    if (!hasRequiredScopes(tokens.scopes)) return finish({ ok: false, reason: "escopos_incompletos" });
    const gmailProfile = await new GmailClient(async () => tokens.accessToken).getProfile();
    if (!gmailProfile.emailAddress) return finish({ ok: false, reason: "falha" });
    const result = await saveMailbox({
      userId: profile.id,
      companyId: saved.companyId,
      email: gmailProfile.emailAddress,
      tokens,
      tokenKey: cfg.tokenKey,
      scopes: tokens.scopes,
    });
    return finish(result);
  } catch (e) {
    console.error("gmail: falha no callback do OAuth:", e instanceof Error ? e.message : e);
    return finish({ ok: false, reason: "falha" });
  }
}
