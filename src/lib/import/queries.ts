import "server-only";
import { createServerClient } from "@/lib/supabase/server";
import type { LogItem } from "./engine";
import type { OxynData } from "./wizard";

export type ImportJobView = {
  id: string;
  status: string;
  mappings: unknown;
  step: string | null;
  counters: Record<string, Record<string, number>>;
  errors: LogItem[];
  warnings: LogItem[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/** Empresas ativas, funis e etapas ativos, e perfis ativos (lidos como o admin geral logado). */
export async function loadOxynData(): Promise<OxynData> {
  const supabase = await createServerClient();
  const [companies, pipelines, profiles] = await Promise.all([
    supabase.from("companies").select("id, name").is("archived_at", null).order("name"),
    supabase
      .from("pipelines")
      .select("id, company_id, name, archived_at, stages(id, name, position, archived_at)")
      .is("archived_at", null)
      .order("name"),
    supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name"),
  ]);
  for (const r of [companies, pipelines, profiles]) if (r.error) throw new Error(`importação: ${r.error.message}`);
  type RawPipe = {
    id: string;
    company_id: string;
    name: string;
    stages: { id: string; name: string; position: number; archived_at: string | null }[];
  };
  return {
    companies: (companies.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    pipelines: ((pipelines.data ?? []) as RawPipe[]).map((p) => ({
      id: p.id,
      companyId: p.company_id,
      name: p.name,
      stages: (p.stages ?? [])
        .filter((s) => s.archived_at === null)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ id: s.id, name: s.name })),
    })),
    profiles: (profiles.data ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email, email: p.email ?? "" })),
  };
}

export async function loadImportJob(id: string): Promise<ImportJobView | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("import_jobs")
    .select("id, status, mappings, cursor, counters, errors, warnings, created_at, started_at, finished_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`importação: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    status: data.status,
    mappings: data.mappings,
    step: (data.cursor as { step?: string } | null)?.step ?? null,
    counters: (data.counters ?? {}) as ImportJobView["counters"],
    errors: (data.errors ?? []) as LogItem[],
    warnings: (data.warnings ?? []) as LogItem[],
    createdAt: data.created_at,
    startedAt: data.started_at,
    finishedAt: data.finished_at,
  };
}

export type ImportJobListItem = {
  id: string;
  status: string;
  step: string | null;
  createdAt: string;
  finishedAt: string | null;
  createdBy: string;
  created: number;
  errors: number;
};

export async function listImportJobs(): Promise<ImportJobListItem[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("import_jobs")
    .select("id, status, cursor, counters, created_at, finished_at, created_by, profiles:created_by(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`importação: ${error.message}`);
  type Raw = {
    id: string;
    status: string;
    cursor: { step?: string } | null;
    counters: Record<string, Record<string, number>> | null;
    created_at: string;
    finished_at: string | null;
    profiles: { full_name: string; email: string } | { full_name: string; email: string }[] | null;
  };
  return ((data ?? []) as unknown as Raw[]).map((j) => {
    const sum = (k: string) => Object.values(j.counters ?? {}).reduce((n, c) => n + (Number(c?.[k]) || 0), 0);
    const p = Array.isArray(j.profiles) ? j.profiles[0] : j.profiles;
    return {
      id: j.id,
      status: j.status,
      step: j.cursor?.step ?? null,
      createdAt: j.created_at,
      finishedAt: j.finished_at,
      createdBy: p?.full_name || p?.email || "",
      created: sum("created"),
      errors: sum("errors"),
    };
  });
}
