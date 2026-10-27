/**
 * Histórico de etapas de um negócio a partir do fluxo do Pipedrive (/v1/deals/{id}/flow, mudanças de stage_id).
 * Primeira linha: de nenhuma etapa para a etapa inicial, na criação do negócio. Depois, uma linha por mudança,
 * com o tempo (em segundos) passado na etapa anterior.
 */
export type StageChange = { from: string; to: string; at: string };
export type StageMove = { from: string | null; to: string; at: string; secondsInPrevious: number | null };

/** "2026-01-16 16:15:13" (UTC do Pipedrive) ou ISO -> ISO em UTC. */
export function pdTimeToIso(v: string): string {
  return /T/.test(v) ? new Date(v).toISOString() : new Date(`${v.replace(" ", "T")}Z`).toISOString();
}

export function stageHistory(addTime: string, currentStage: string, changes: StageChange[]): StageMove[] {
  const sorted = [...changes].sort((a, b) => pdTimeToIso(a.at).localeCompare(pdTimeToIso(b.at)));
  const first = sorted[0]?.from ?? currentStage;
  const moves: StageMove[] = [{ from: null, to: first, at: pdTimeToIso(addTime), secondsInPrevious: null }];
  for (const c of sorted) {
    const prev = moves[moves.length - 1]!;
    const at = pdTimeToIso(c.at);
    const secs = Math.max(0, Math.floor((Date.parse(at) - Date.parse(prev.at)) / 1000));
    moves.push({ from: c.from, to: c.to, at, secondsInPrevious: secs });
  }
  return moves;
}
