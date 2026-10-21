"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/auth/field";
import { requestPasswordReset } from "@/lib/auth/actions";

export function RecoveryForm() {
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    await requestPasswordReset(String(form.get("email")));
    setDone(true);
    setLoading(false);
  }

  return (
    <div className="grid gap-6">
      <h1 className="font-heading text-2xl font-semibold">Recuperar senha</h1>
      {done ? (
        <p role="status" className="text-sm">
          Se o e-mail estiver cadastrado, você vai receber um link.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="E-mail" name="email" type="email" autoComplete="email" required />
          <Button type="submit" disabled={loading} className="h-10">
            Enviar link
          </Button>
        </form>
      )}
      <Link href="/entrar" className="text-sm text-primary hover:underline">
        Voltar para o login
      </Link>
    </div>
  );
}
