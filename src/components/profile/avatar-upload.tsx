"use client";

import { useRef, useState, useTransition } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AVATAR_ERROR, AVATAR_MAX_BYTES, AVATAR_TYPES } from "@/lib/profile/avatar";
import { uploadAvatar } from "@/lib/profile/actions";

export function AvatarUpload({
  avatarUrl,
  initials,
}: {
  avatarUrl: string | null;
  initials: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setDone(false);
    if (!(file.type in AVATAR_TYPES) || file.size > AVATAR_MAX_BYTES) {
      setError(AVATAR_ERROR);
      return;
    }
    startTransition(async () => {
      const result = await uploadAvatar(file);
      if (result.ok) {
        setDone(true);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Foto</CardTitle>
        <CardDescription>PNG, JPG ou WebP de até 2 MB.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <Avatar className="size-16">
          {avatarUrl ? <AvatarImage src={avatarUrl} alt="Sua foto" /> : null}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="grid gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            data-testid="avatar-input"
            aria-label="Arquivo da foto"
            onChange={onChange}
          />
          <div>
            <Button type="button" variant="outline" disabled={pending} onClick={() => input.current?.click()}>
              Trocar foto
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="text-sm text-muted-foreground">
              Foto atualizada.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
