import "server-only";
import { createPipedriveClient, PipedriveAuthError, type PipedriveClient } from "./pipedrive/client";
import type { PdFieldDef } from "./pipedrive/types";
import { refId } from "./mapping";
import { isCustomField, type DiscoveredField, type Discovery } from "./wizard";

export const PIPEDRIVE_MESSAGES = {
  missing: "O token do Pipedrive não está configurado. Defina PIPEDRIVE_API_TOKEN no ambiente do servidor e tente de novo.",
  auth: "O Pipedrive recusou o token (401). Confira se PIPEDRIVE_API_TOKEN está correto e tem permissão de leitura.",
  other: "Não foi possível falar com o Pipedrive agora. Tente de novo em instantes.",
};

/** Cliente com o token do ambiente do servidor (nunca vai para o navegador); null quando não há token. */
export function pipedriveFromEnv(): PipedriveClient | null {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) return null;
  return createPipedriveClient({ token, baseUrl: process.env.PIPEDRIVE_BASE_URL || undefined });
}

export function pipedriveErrorMessage(e: unknown): string {
  return e instanceof PipedriveAuthError ? PIPEDRIVE_MESSAGES.auth : PIPEDRIVE_MESSAGES.other;
}

const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Funis, etapas, usuários, etiquetas de lead e campos personalizados do Pipedrive. */
export async function loadDiscovery(): Promise<{ ok: true; data: Discovery } | { ok: false; error: string }> {
  const client = pipedriveFromEnv();
  if (!client) return { ok: false, error: PIPEDRIVE_MESSAGES.missing };
  try {
    const [pipelines, stages, users, labels, dealFields, personFields, orgFields] = await Promise.all([
      client.pipelines(),
      client.stages(),
      client.users(),
      client.leadLabels(),
      client.dealFields(),
      client.personFields(),
      client.organizationFields(),
    ]);
    const fields = (list: PdFieldDef[], entity: DiscoveredField["entity"]): DiscoveredField[] =>
      list
        .filter((f) => typeof f.key === "string" && isCustomField(f as PdFieldDef & { edit_flag?: unknown }))
        .map((f) => ({ key: f.key, name: text(f.name).trim() || f.key, type: text(f.field_type), entity }));
    const data: Discovery = {
      pipelines: pipelines.flatMap((p) => {
        const id = refId(p.id);
        return id ? [{ id, name: text(p.name) || `Funil ${id}` }] : [];
      }),
      stages: stages
        .flatMap((s) => {
          const id = refId(s.id);
          const pipelineId = refId(s.pipeline_id);
          return id && pipelineId ? [{ id, pipelineId, name: text(s.name).trim() || `Etapa ${id}`, order: Number(s.order_nr ?? 0) || 0 }] : [];
        })
        .sort((a, b) => a.order - b.order),
      users: users.flatMap((u) => {
        const id = refId(u.id);
        return id ? [{ id, name: text(u.name) || `Usuário ${id}`, email: text(u.email), active: u.active_flag !== false }] : [];
      }),
      labels: labels.flatMap((l) => {
        const id = refId(l.id);
        return id ? [{ id, name: text(l.name) || id }] : [];
      }),
      fields: [...fields(dealFields, "deals"), ...fields(personFields, "persons"), ...fields(orgFields, "organizations")],
    };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: pipedriveErrorMessage(e) };
  }
}
