import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/entrar", "/recuperar-senha", "/auth/confirm", "/auth/callback"];
// Rotas de cron se autenticam sozinhas com CRON_SECRET (Bearer), sem sessão de usuário.
const SELF_AUTH = ["/api/cron"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  // getClaims valida o JWT localmente quando o projeto usa chaves assimétricas
  // (com HS256 legado a biblioteca consulta o Auth, mantendo o comportamento).
  // Ban/inatividade: com a verificação local, o ban só aparece quando o token
  // expira ou é renovado (refresh falha com user_banned); enquanto isso,
  // requireUser lê `profiles.active` via RLS e derruba a sessão.
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const user = claimsData?.claims.sub ? claimsData.claims : null;

  const path = request.nextUrl.pathname;
  const isPublic = [...PUBLIC, ...SELF_AUTH].some((p) => path === p || path.startsWith(p + "/"));
  if (!user && error?.code === "user_banned" && !isPublic) {
    // Acesso desativado (ban no Auth): derruba a sessão e explica o motivo.
    await supabase.auth.signOut({ scope: "local" });
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = "";
    url.searchParams.set("erro", "inativo");
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  }
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return response;
}
