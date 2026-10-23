"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ActivityRow } from "@/lib/activities/queries";
import { CompleteDialog } from "./complete-dialog";
import { completeDataFor, type PageCtx } from "./page-context";

/** Abre o `CompleteDialog` da atividade escolhida, com o catálogo da empresa dela, e atualiza a página ao concluir. */
export function CompleteHost({
  activity,
  ctx,
  onClose,
}: {
  activity: ActivityRow | null;
  ctx: PageCtx;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const company = ctx.companies.find((c) => c.id === activity?.companyId);
  if (activity && !company) return null;
  return (
    <CompleteDialog
      activity={activity}
      data={completeDataFor(ctx, company ?? ctx.companies[0])}
      onClose={onClose}
      onChanged={() => startTransition(() => router.refresh())}
    />
  );
}
