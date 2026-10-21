"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile } from "@/lib/profile/actions";

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(fullName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateProfile({ fullName: name });
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.fieldErrors?.fullName ?? result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Dados</CardTitle>
        <CardDescription>Seu nome aparece para os outros usuários.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-name">Nome</Label>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="profile-email">E-mail</Label>
            <Input id="profile-email" value={email} readOnly disabled />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm text-muted-foreground">
              Dados salvos.
            </p>
          )}
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Salvar dados"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
