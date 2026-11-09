"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveCalendarSync } from "@/lib/calendar/settings-actions";

/** Liga/desliga a sincronização com a Agenda do Google da empresa. O que vale é o que foi salvo. */
export function CalendarSyncForm({ companyId, enabled: initialEnabled }: { companyId: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveCalendarSync(companyId, enabled);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Configurações salvas.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      <div className="flex items-start gap-3 rounded-md border p-3">
        <Switch id="calendar-sync-enabled" checked={enabled} disabled={pending} onCheckedChange={setEnabled} />
        <Label htmlFor="calendar-sync-enabled" className="text-sm">
          Sincronizar com a Agenda do Google
        </Label>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending || enabled === initialEnabled}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
