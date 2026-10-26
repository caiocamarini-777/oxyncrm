import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomFieldDef, ExistingPipeline, ImportStore, JobRecord, UpsertCounts } from "./engine";

type Res<T> = { data: T | null; error: { message: string } | null };

function must<T>(op: string, r: Res<T>): T {
  if (r.error) throw new Error(`${op}: ${r.error.message}`);
  return r.data as T;
}

/** Armazenamento do motor sobre o cliente admin (service_role). Escritas de dados passam pelas funções import_*. */
export function createSupabaseStore(admin: SupabaseClient): ImportStore {
  const nowIso = () => new Date().toISOString();
  return {
    async loadJob(id) {
      const r = await admin.from("import_jobs").select("id, status, mappings, cursor, counters").eq("id", id).maybeSingle();
      return must("loadJob", r) as JobRecord | null;
    },
    async claim(id, token, seconds) {
      return must("import_claim", await admin.rpc("import_claim", { p_job: id, p_owner: token, p_seconds: seconds })) === true;
    },
    async release(id, token) {
      must("import_release", await admin.rpc("import_release", { p_job: id, p_owner: token }));
    },
    async start(id) {
      const r = await admin
        .from("import_jobs")
        .update({ status: "running" })
        .eq("id", id)
        .in("status", ["draft", "running"])
        .select("id");
      const ok = (must("start", r) ?? []).length > 0;
      if (ok) must("start", await admin.from("import_jobs").update({ started_at: nowIso() }).eq("id", id).is("started_at", null));
      return ok;
    },
    async saveCursor(id, token, cursor) {
      const r = await admin
        .from("import_jobs")
        .update({ cursor })
        .eq("id", id)
        .eq("lease_owner", token)
        .in("status", ["running", "paused"])
        .select("status");
      const rows = (must("saveCursor", r) ?? []) as { status: string }[];
      return rows[0]?.status === "running";
    },
    async finish(id, token, status) {
      must(
        "finish",
        await admin
          .from("import_jobs")
          .update({ status, finished_at: nowIso() })
          .eq("id", id)
          .eq("status", "running")
          .eq("lease_owner", token),
      );
    },
    async upsert(id, entity, rows) {
      return must("import_upsert", await admin.rpc("import_upsert", { p_job: id, p_entity: entity, p_rows: rows })) as UpsertCounts;
    },
    async count(id, entity, counts) {
      must("import_count", await admin.rpc("import_count", { p_job: id, p_entity: entity, p_counts: counts }));
    },
    async log(id, items) {
      must("import_log_items", await admin.rpc("import_log_items", { p_job: id, p_items: items }));
    },
    async rebuildDerivatives(id) {
      must("import_rebuild_deal_derivatives", await admin.rpc("import_rebuild_deal_derivatives", { p_job: id }));
    },
    async members(companyIds) {
      const ms = (must("memberships", await admin.from("memberships").select("user_id, company_id").in("company_id", companyIds)) ??
        []) as { user_id: string; company_id: string }[];
      const ids = [...new Set(ms.map((m) => m.user_id))];
      const sel = "id, full_name, email, active, is_super_admin";
      const admins = (must("profiles", await admin.from("profiles").select(sel).eq("is_super_admin", true)) ?? []) as Profile[];
      const others = ids.length
        ? ((must("profiles", await admin.from("profiles").select(sel).in("id", ids)) ?? []) as Profile[])
        : [];
      const companies = (must("companies", await admin.from("companies").select("id, name").in("id", companyIds)) ?? []) as {
        id: string;
        name: string;
      }[];
      const profiles = new Map([...admins, ...others].map((p) => [p.id, p]));
      const active: Record<string, string[]> = {};
      for (const c of companyIds) {
        const users = new Set(admins.filter((p) => p.active).map((p) => p.id));
        for (const m of ms) if (m.company_id === c && profiles.get(m.user_id)?.active) users.add(m.user_id);
        active[c] = [...users];
      }
      return {
        active,
        userNames: Object.fromEntries([...profiles.values()].map((p) => [p.id, p.full_name || p.email])),
        companyNames: Object.fromEntries(companies.map((c) => [c.id, c.name])),
      };
    },
    async customFieldDefs(companyIds) {
      const r = await admin.from("custom_field_defs").select("id, company_id, entity, key, type, options").in("company_id", companyIds);
      return (must("custom_field_defs", r) ?? []) as CustomFieldDef[];
    },
    async createCustomFieldDef(def) {
      must("custom_field_defs", await admin.from("custom_field_defs").insert(def));
    },
    async setCustomFieldOptions(id, options) {
      must("custom_field_defs", await admin.from("custom_field_defs").update({ options }).eq("id", id));
    },
    async findPipeline(companyId, name) {
      const r = await admin
        .from("pipelines")
        .select("id, archived_at, stages(id, name, position, archived_at)")
        .eq("company_id", companyId)
        .eq("name", name)
        .maybeSingle();
      type Raw = { id: string; archived_at: string | null; stages: { id: string; name: string; position: number; archived_at: string | null }[] };
      const p = must("pipelines", r) as Raw | null;
      if (!p) return null;
      const out: ExistingPipeline = {
        id: p.id,
        archived: p.archived_at !== null,
        stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name, position: s.position, archived: s.archived_at !== null })),
      };
      return out;
    },
    async createPipeline(companyId, name) {
      const r = await admin.from("pipelines").insert({ company_id: companyId, name }).select("id").single();
      return (must("pipelines", r) as { id: string }).id;
    },
    async createStage(pipelineId, companyId, s) {
      const r = await admin
        .from("stages")
        .insert({ pipeline_id: pipelineId, company_id: companyId, name: s.name, position: s.position, probability: s.probability })
        .select("id")
        .single();
      return (must("stages", r) as { id: string }).id;
    },
  };
}

type Profile = { id: string; full_name: string; email: string; active: boolean; is_super_admin: boolean };
