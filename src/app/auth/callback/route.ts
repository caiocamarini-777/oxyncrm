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
  }
  redirect("/entrar?erro=google");
}
