"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validatePassword } from "@/lib/auth/password";
import { changePassword } from "@/lib/profile/actions";

export function PasswordForm() {
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setDone(false);
    const invalid = validatePassword(password, confirm);
    setError(invalid);
    if (invalid) return;
    startTransition(async () => {
      const result = await changePassword({ password, confirm });
      if (result.ok) {
        setPassword("");
        setConfirm("");
        setDone(true);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Senha</CardTitle>
        <CardDescription>Mínimo de 8 caracteres.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">Nova senha</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-password">Confirmar senha</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="text-sm text-muted-foreground">
              Senha alterada.
            </p>
          )}
          <div>
            <Button type="submit" disabled={pending}>
              Alterar senha
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
