"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LostDialog, type LostReasonOption } from "@/components/deals/lost-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { markLost, markWon, reopenDeal } from "@/lib/deals/actions";
import type { DealStatus } from "@/lib/deals/schema";

const STATUS_LABEL: Record<DealStatus, string> = { open: "Aberto", won: "Ganho", lost: "Perdido" };

/** Status do negócio e as ações Ganho / Perdido / Reabrir. */
export function DealActions({
  dealId,
  title,
  status,
  reasons,
  canEdit,
}: {
  dealId: string;
  title: string;
  status: DealStatus;
  reasons: LostReasonOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [lostOpen, setLostOpen] = useState(false);
  const [pending, start] = useTransition();

  function run(fn: () => ReturnType<typeof markWon>, success: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="secondary" data-testid="deal-status">
        {STATUS_LABEL[status]}
      </Badge>
      {canEdit && status === "open" ? (
        <>
          <Button type="button" disabled={pending} onClick={() => run(() => markWon(dealId), "Negócio marcado como ganho.")}>
            Ganho
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setLostOpen(true)}>
            Perdido
          </Button>
          <LostDialog
            open={lostOpen}
            onOpenChange={setLostOpen}
            dealTitle={title}
            reasons={reasons}
            onConfirm={async (input) => {
              const res = await markLost(dealId, input);
              if (res.ok) {
                toast.success("Negócio marcado como perdido.");
                router.refresh();
              }
              return res;
            }}
          />
        </>
      ) : null}
      {canEdit && status !== "open" ? (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => reopenDeal(dealId), "Negócio reaberto.")}>
          Reabrir
        </Button>
      ) : null}
    </div>
  );
}
