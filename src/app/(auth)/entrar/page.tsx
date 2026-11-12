import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { safeNext } from "@/lib/auth/redirect";
import { getCurrentProfile } from "@/lib/auth/session";

async function Content({ searchParams }: { searchParams: PageProps<"/entrar">["searchParams"] }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? null));
  const next = one(sp.next);
  // Sessão ativa vai direto para o CRM: quem abre /entrar por favorito ou pelo endereço que o navegador sugere
  // via o formulário de novo e achava que precisava entrar toda vez. Usuário inativo segue no formulário.
  const profile = await getCurrentProfile();
  if (profile?.active) redirect(safeNext(next));
  return <LoginForm next={next} erro={one(sp.erro)} />;
}

export default function Page(props: PageProps<"/entrar">) {
  return (
    <Suspense>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
