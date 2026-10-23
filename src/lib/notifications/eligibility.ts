export type EmailCandidate = {
  userId: string;
  profile: { email: string; active: boolean } | null;
  activity: { done: boolean; deleted_at: string | null; owner_id: string } | null;
};

/** Decide o destino de uma notificação pendente de e-mail. `stale` = atividade concluída, excluída ou reatribuída. */
export function emailDecision(c: EmailCandidate): "send" | "inactive" | "stale" {
  const a = c.activity;
  if (a && (a.done || a.deleted_at !== null || a.owner_id !== c.userId)) return "stale";
  if (!c.profile?.active || !c.profile.email) return "inactive";
  return "send";
}
