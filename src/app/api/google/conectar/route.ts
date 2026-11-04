import { connection, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import {
  callbackRedirectUri,
  isUuid,
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE,
  OAUTH_COOKIE_PATH,
  profileRedirectPath,
  serializeOauthCookie,
} from "@/lib/gmail/connect";
import { userCanUseCompany } from "@/lib/gmail/connect-server";
import { buildAuthUrl, gmailConfig, newState } from "@/lib/gmail/oauth";

/** Início do OAuth: confere sessão e empresa, grava o cookie com `state` e manda para o Google. */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const siteBase = process.env.NEXT_PUBLIC_SITE_URL?.trim() || url.origin;
  const back = (path: string) => NextResponse.redirect(new URL(path, siteBase));

  const profile = await getCurrentProfile();
  if (!profile || !profile.active) return back("/entrar");

  const cfg = gmailConfig();
  if (!cfg) return back(profileRedirectPath({ ok: false, reason: "nao_configurado" }));

  const companyId = url.searchParams.get("empresa");
  if (!isUuid(companyId) || !(await userCanUseCompany(companyId))) {
    return back(profileRedirectPath({ ok: false, reason: "falha" }));
  }

  const state = newState();
  const res = NextResponse.redirect(
    buildAuthUrl({
      clientId: cfg.clientId,
      redirectUri: callbackRedirectUri(process.env.NEXT_PUBLIC_SITE_URL, url.origin),
      state,
    }),
  );
  res.cookies.set(OAUTH_COOKIE, serializeOauthCookie({ state, companyId }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: OAUTH_COOKIE_MAX_AGE,
    path: OAUTH_COOKIE_PATH,
  });
  return res;
}
