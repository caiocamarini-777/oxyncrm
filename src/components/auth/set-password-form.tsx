"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/auth/field";
import { setPassword } from "@/lib/auth/actions";

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, { error: null });
  return (
    <div className="grid gap-6">
      <h1 className="font-heading text-2xl font-semibold">Definir senha</h1>
      <form action={action} className="grid gap-4">
        <Field label="Nova senha" name="password" type="password" autoComplete="new-password" required />
        <Field label="Confirmar senha" name="confirm" type="password" autoComplete="new-password" required />
        {state.error && <FormError>{state.error}</FormError>}
        <Button type="submit" disabled={pending} className="h-10">
          Salvar senha
        </Button>
      </form>
    </div>
  );
}
