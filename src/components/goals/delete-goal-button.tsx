"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { deleteGoal } from "@/lib/reports/actions";

export function DeleteGoalButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Excluir meta ${label}`}
        onClick={() =>
          startTransition(async () => {
            const res = await deleteGoal(id);
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        Excluir
      </Button>
    </div>
  );
}
