"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/auth/field";
import { createBrowserClient } from "@/lib/supabase/client";

export function SetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== String(form.get("confirm"))) {
      setError("As senhas não conferem.");
      return;
    }
    setError(null);
    setLoading(true);
    const supabase = createBrowserClient();
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setError("Não foi possível salvar a senha. Tente novamente.");
      setLoading(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <h1 className="font-heading text-2xl font-semibold">Definir senha</h1>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label="Nova senha" name="password" type="password" autoComplete="new-password" required />
        <Field label="Confirmar senha" name="confirm" type="password" autoComplete="new-password" required />
        {error && <FormError>{error}</FormError>}
        <Button type="submit" disabled={loading} className="h-10">
          Salvar senha
        </Button>
      </form>
    </div>
  );
}
