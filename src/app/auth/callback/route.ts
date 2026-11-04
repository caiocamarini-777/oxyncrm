import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { isUninvitedGoogleSignup } from "@/lib/auth/google-guard";
import { safeNext } from "@/lib/auth/redirect";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Erro devolvido pelo Supabase/Google (antes de haver usuário): registra o motivo real.
  const oauthError = searchParams.get("error");
  if (oauthError) {
    console.error(
      `Login Google falhou: ${oauthError} (${searchParams.get("error_code") ?? "-"}): ${searchParams.get("error_description") ?? ""}`,
    );
    redirect("/entrar?erro=google_falha");
  }

  if (code) {
    const supabase = await createServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      if (isUninvitedGoogleSignup(data.user)) {
        // Cadastro aberto não existe: remove a conta criada por este login.
        await supabase.auth.signOut();
        const { error: deleteError } = await createAdminClient().auth.admin.deleteUser(
          data.user.id,
        );
        if (deleteError) {
          console.error(
            `Falha ao remover conta Google sem convite (usuário ${data.user.id}): ${deleteError.message}`,
          );
        }
        redirect("/entrar?erro=google");
      }
      redirect(next);
    }
    if (error) console.error(`Login Google falhou na troca do código: ${error.code ?? "-"}: ${error.message}`);
  }
  redirect("/entrar?erro=google_falha");
}
