import { translateDbError } from "@/lib/db-errors";

export type CompleteCode = "next_required" | "meeting_required" | "outcome_required";

const CODES: [string, CompleteCode][] = [
  ["OXYN_NEXT_ACTIVITY_REQUIRED", "next_required"],
  ["OXYN_MEETING_REQUIRED", "meeting_required"],
  ["OXYN_OUTCOME_REQUIRED", "outcome_required"],
];

/** Erro do RPC `complete_activity` para a resposta da ação (texto PT-BR, código e regra). */
export function completeFailure(error: { code?: string; message?: string }): {
  ok: false;
  error: string;
  code?: CompleteCode;
  rule?: "require";
} {
  const hit = CODES.find(([c]) => error.message?.includes(c));
  return {
    ok: false,
    error: translateDbError(error),
    ...(hit ? { code: hit[1] } : {}),
    ...(hit?.[1] === "next_required" ? { rule: "require" as const } : {}),
  };
}
