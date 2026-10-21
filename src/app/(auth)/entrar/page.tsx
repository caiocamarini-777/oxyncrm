import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

async function Content({ searchParams }: { searchParams: PageProps<"/entrar">["searchParams"] }) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : (v ?? null));
  return <LoginForm next={one(sp.next)} erro={one(sp.erro)} />;
}

export default function Page(props: PageProps<"/entrar">) {
  return (
    <Suspense>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
