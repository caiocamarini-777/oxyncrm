"use client";

import { Button } from "@/components/ui/button";

export default function ReportsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="space-y-3 py-12 text-center">
      <p className="text-sm text-muted-foreground">Não foi possível carregar esta página de relatórios.</p>
      <Button variant="outline" onClick={reset}>
        Tentar de novo
      </Button>
    </div>
  );
}
