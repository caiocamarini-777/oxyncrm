"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function ThemePreference() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Aparência</CardTitle>
        <CardDescription>Escolha o tema da interface.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          value={mounted ? (theme ?? "system") : ""}
          onValueChange={(v) => v && setTheme(v)}
          aria-label="Tema"
        >
          <ToggleGroupItem value="light">Claro</ToggleGroupItem>
          <ToggleGroupItem value="dark">Escuro</ToggleGroupItem>
          <ToggleGroupItem value="system">Sistema</ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
  );
}
