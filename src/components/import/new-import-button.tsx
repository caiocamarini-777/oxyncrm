"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createImportJob } from "@/lib/import/actions";

export function NewImportButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const r = await createImportJob();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/configuracoes/importacao/${r.data.id}`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button type="button" disabled={pending} onClick={create}>
        {pending ? "Lendo o Pipedrive..." : "Nova importação"}
      </Button>
      {error && (
        <p role="alert" className="max-w-md text-right text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
