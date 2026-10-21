"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/auth/field";
import { safeNext } from "@/lib/auth/redirect";
import { createBrowserClient } from "@/lib/supabase/client";

const ERRORS: Record<string, string> = {
  inativo: "Seu acesso foi desativado. Fale com o administrador.",
  link: "Este link expirou ou já foi usado. Peça um novo.",
  google: "Este e-mail não tem convite para o Oxyn CRM.",
};

export function LoginForm({ next, erro }: { next: string | null; erro: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(erro ? (ERRORS[erro] ?? null) : null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const supabase = createBrowserClient();
    const { error: err } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    });
    if (err) {
      setError("E-mail ou senha incorretos.");
      setLoading(false);
      return;
    }
    router.replace(safeNext(next));
    router.refresh();
  }

  async function google() {
    setError(null);
    const supabase = createBrowserClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback` },
    });
    if (err) setError(ERRORS.google);
  }

  return (
    <div className="grid gap-6">
      <h1 className="font-heading text-2xl font-semibold">Entrar</h1>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="E-mail" name="email" type="email" autoComplete="email" required />
        <Field
          label="Senha"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error && <FormError>{error}</FormError>}
        <Button type="submit" disabled={loading} className="h-10">
          Entrar
        </Button>
      </form>
      <Button type="button" variant="outline" className="h-10" onClick={google}>
        Entrar com Google
      </Button>
      <Link href="/recuperar-senha" className="text-sm text-primary hover:underline">
        Esqueci minha senha
      </Link>
    </div>
  );
}
