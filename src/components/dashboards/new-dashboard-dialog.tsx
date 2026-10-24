"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createDashboard } from "@/lib/reports/actions";

export function NewDashboardDialog({ empresa }: { empresa: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createDashboard(name);
      if (!res.ok) {
        setError(res.fieldErrors?.name ?? res.error);
        return;
      }
      setOpen(false);
      router.push(`/${empresa}/relatorios/dashboards/${res.data.id}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setName("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>Novo dashboard</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Novo dashboard</DialogTitle>
            <DialogDescription>Dê um nome. Depois você adiciona os widgets.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="dashboard-name">Nome</Label>
            <Input
              id="dashboard-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "dashboard-name-error" : undefined}
              autoFocus
            />
            {error ? (
              <p id="dashboard-name-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
