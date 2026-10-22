/** Posição entre dois vizinhos; nas pontas, passo de 1.024. */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0;
  if (before === null) return (after as number) - 1024;
  if (after === null) return before + 1024;
  return (before + after) / 2;
}

export type CardValueDeal = {
  contractValue: number;
  estimatedValue: number | null;
  mrr: number;
  setupTotal: number;
};

export function cardValue(deal: CardValueDeal, field: "total" | "mrr" | "setup"): number {
  if (field === "mrr") return deal.mrr;
  if (field === "setup") return deal.setupTotal;
  return deal.contractValue > 0 ? deal.contractValue : (deal.estimatedValue ?? 0);
}

/** Esfriando: negócio aberto parado na etapa há mais dias que o limite dela. */
export function isRotting(
  deal: { status: string; stageEnteredAt: string },
  stage: { rottingDays: number | null },
  now: Date,
): boolean {
  if (deal.status !== "open" || stage.rottingDays === null) return false;
  return now.getTime() - new Date(deal.stageEnteredAt).getTime() > stage.rottingDays * 86_400_000;
}

/** Uma coluna por etapa, na ordem recebida; a ordem dos negócios é preservada. */
export function groupByStage<D extends { stageId: string }, S extends { id: string }>(
  deals: D[],
  stages: S[],
): { stage: S; deals: D[] }[] {
  const by = new Map<string, D[]>(stages.map((s) => [s.id, []]));
  for (const d of deals) by.get(d.stageId)?.push(d);
  return stages.map((stage) => ({ stage, deals: by.get(stage.id) ?? [] }));
}

/** Dias inteiros desde `iso` (nunca negativo). */
export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}
