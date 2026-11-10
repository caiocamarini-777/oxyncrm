/**
 * Banco da atualização do Pipedrive pelo CRM (piloto pós-virada): o liga/desliga e o cursor, a trava do espelho,
 * as mudanças e exclusões desde o cursor, os vínculos em `external_ids`, a fila de retry e o relatório das rodadas.
 * Usa o cliente com service role: as tabelas `pipedrive_push_*` e `external_ids` não têm política para os usuários.
 *
 * `supabasePushStore(db, client)` recebe também o cliente do Pipedrive, só para as leituras de `buildContext`
 * (campos do negócio, campos e tipos de atividade). Nada aqui escreve no Pipedrive.
 *
 * Ids do Pipedrive (`external_ids`): o contexto das conversões é síncrono, então os ids são carregados sob demanda,
 * em lote, por `changed` e `loadOne` (o registro e os relacionados dele) e um a um por `pdIdOf`; `link` e `unlink`
 * atualizam o que já foi carregado. Id ainda não carregado vale null no contexto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipedriveClient } from "@/lib/import/pipedrive/client";
import { stagePipedriveIdFor } from "@/lib/meet/decisions";
import { PUSH_SELECT, type PushCtx, type PushEntity } from "./mapping";

export interface PushStore {
  settings(): Promise<{ enabled: boolean; cursor: string | null }>;
  mirrorActive(now: Date): Promise<boolean>;
  /** Mapas do último job de importação concluído, ao contrário, e os metadados do Pipedrive. Uma vez por rodada. */
  buildContext(): Promise<PushCtx>;
  /**
   * Registros fora da lixeira com `updated_at > since`, por `updated_at` e `id`, até `limit` (no máximo 1000, o teto
   * do PostgREST). Página seguinte: `since` = `updated_at` da última linha (o texto como veio do banco, sem passar
   * por `Date`, que perde os microssegundos) e `after` = `id` dela; a consulta pega `(updated_at, id) > (since, after)`.
   */
  changed(entity: PushEntity, since: string, limit: number, after?: string): Promise<Record<string, unknown>[]>;
  /** Registros que foram para a lixeira depois de `since` (todas as páginas). */
  deleted(entity: PushEntity, since: string): Promise<{ id: string; company_id: string }[]>;
  /** A fila inteira, na ordem das dependências (organizações → anotações). */
  retryQueue(): Promise<{ entity: PushEntity; record_id: string; company_id: string; attempts: number }[]>;
  /** A linha (com `PUSH_SELECT`) fora da lixeira; null se foi para a lixeira ou não existe mais. */
  loadOne(entity: PushEntity, id: string): Promise<Record<string, unknown> | null>;
  pdIdOf(entity: PushEntity, crmId: string): Promise<string | null>;
  /** `pipedrive_push_link`. Não apaga um vínculo antigo do registro com outro id: para religar, `unlink` antes. */
  link(entity: PushEntity, pdId: string, companyId: string, recordId: string): Promise<void>;
  unlink(entity: PushEntity, recordId: string): Promise<void>;
  /** Primeira falha entra com 1 tentativa; as seguintes somam 1 e trocam o último erro. */
  queueRetry(entity: PushEntity, recordId: string, companyId: string, error: string): Promise<void>;
  clearRetry(entity: PushEntity, recordId: string): Promise<void>;
  startRun(cursorFrom: string): Promise<string>;
  finishRun(
    id: string,
    r: { status: "done" | "failed"; cursorTo: string; counters: unknown; errors: unknown },
  ): Promise<void>;
  saveCursor(cursor: string): Promise<void>;
  /** Ligar grava `enabled_at` e o cursor = `now` (se já estava ligada, nada muda). Desligar mantém o cursor. */
  setEnabled(enabled: boolean, now: Date): Promise<void>;
}

/** O que `buildContext` lê do Pipedrive. */
export type PushMetaClient = Pick<PipedriveClient, "dealFields" | "activityFields" | "activityTypes">;

/** Ordem de envio (dependências); as exclusões vão na ordem inversa. */
export const PUSH_ORDER: readonly PushEntity[] = ["organizations", "persons", "leads", "deals", "activities", "notes"];

/** O espelho vale enquanto o último job de importação concluído rodou como espelho há menos que isto. */
export const MIRROR_GUARD_MS = 48 * 3600_000;

/** Linhas por página nas leituras que trazem tudo (abaixo do teto de 1000 do PostgREST). */
const PAGE = 500;
/** Registros por consulta a `external_ids` (a lista vai na URL). */
const LINK_CHUNK = 150;
const MAX_ERROR_CHARS = 1000;
const SETTINGS_ID = 1;

/** Colunas que apontam para outro registro, por tabela (as anotações apontam por `entity` + `record_id`). */
const REFS: Record<PushEntity, [string, PushEntity][]> = {
  organizations: [],
  persons: [["organization_id", "organizations"]],
  leads: [
    ["person_id", "persons"],
    ["organization_id", "organizations"],
  ],
  deals: [
    ["person_id", "persons"],
    ["organization_id", "organizations"],
  ],
  activities: [
    ["deal_id", "deals"],
    ["lead_id", "leads"],
    ["person_id", "persons"],
    ["organization_id", "organizations"],
  ],
  notes: [],
};

/**
 * Nome do tipo no CRM (sem acento e sem maiúsculas) → key do tipo padrão do Pipedrive, quando o nome não bate com
 * nenhum tipo de lá (ex.: "Ligação" no CRM, "Chamada" no Pipedrive).
 */
const TYPE_ALIASES: Record<string, string> = {
  ligacao: "call",
  chamada: "call",
  telefonema: "call",
  reuniao: "meeting",
  tarefa: "task",
  prazo: "deadline",
  "e-mail": "email",
  email: "email",
  almoco: "lunch",
};

type Row = Record<string, unknown>;
type StageMap = Record<string, { stages: Record<string, string | null> }>;
type ImportMaps = {
  mappings?: {
    users?: Record<string, unknown>;
    pipelines?: StageMap;
    leadLabelCompany?: Record<string, unknown>;
    ignoreLeadLabels?: unknown[];
    customFields?: Record<string, { target?: string; customFieldKey?: string } | null>;
  } | null;
  cursor?: { cache?: { pipelines?: StageMap } | null } | null;
};

const isPushEntity = (v: unknown): v is PushEntity => typeof v === "string" && (PUSH_ORDER as string[]).includes(v);

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Valor entre aspas para os filtros do `.or` do PostgREST (timestamps têm `.` e `:`). */
const quoted = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

function check(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`Falha ao ${what}: ${error.message}`);
}

export function supabasePushStore(db: SupabaseClient, client: PushMetaClient): PushStore {
  /** "<entidade>:<id no CRM>" → id no Pipedrive (null: sem vínculo). Só o que já foi carregado. */
  const links = new Map<string, string | null>();
  const linkKey = (entity: PushEntity, crmId: string) => `${entity}:${crmId}`;

  async function loadLinks(entity: PushEntity, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += LINK_CHUNK) {
      const chunk = ids.slice(i, i + LINK_CHUNK);
      const { data, error } = await db
        .from("external_ids")
        .select("record_id, external_id")
        .eq("source", "pipedrive")
        .eq("entity", entity)
        .in("record_id", chunk)
        .order("imported_at", { ascending: false });
      check(error, "ler os ids do Pipedrive");
      // mais de um vínculo para o mesmo registro: vale o gravado por último
      const found = new Map<string, string>();
      for (const r of (data ?? []) as { record_id: string; external_id: string }[]) {
        if (!found.has(r.record_id)) found.set(r.record_id, r.external_id);
      }
      for (const id of chunk) links.set(linkKey(entity, id), found.get(id) ?? null);
    }
  }

  /** Carrega, em lote, os ids do Pipedrive das linhas e dos registros a que elas apontam. */
  async function warm(entity: PushEntity, rows: Row[]): Promise<void> {
    const want = new Map<PushEntity, Set<string>>();
    const add = (e: PushEntity, id: unknown) => {
      if (typeof id !== "string" || !id || links.has(linkKey(e, id))) return;
      const set = want.get(e) ?? new Set<string>();
      set.add(id);
      want.set(e, set);
    };
    for (const r of rows) {
      add(entity, r.id);
      for (const [column, target] of REFS[entity]) add(target, r[column]);
      if (entity === "notes" && isPushEntity(r.entity)) add(r.entity, r.record_id);
    }
    for (const [e, ids] of want) await loadLinks(e, [...ids]);
  }

  /** Último job de importação do Pipedrive concluído (mesma consulta da trava do espelho). */
  async function lastImport<T>(columns: string): Promise<T | null> {
    const { data, error } = await db
      .from("import_jobs")
      .select(columns)
      .eq("source", "pipedrive")
      .eq("status", "done")
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    check(error, "ler as importações do Pipedrive");
    return data as unknown as T | null;
  }

  /** Todas as páginas de uma consulta, pelo `id` (ou outra coluna única) em ordem crescente. */
  async function allPages<T extends Row>(
    what: string,
    key: keyof T & string,
    page: (after: string | null) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<T[]> {
    const out: T[] = [];
    let after: string | null = null;
    for (;;) {
      const { data, error } = await page(after);
      check(error, what);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
      after = String(rows[rows.length - 1][key]);
    }
  }

  async function updateSettings(values: Row, onlyIfDisabled = false): Promise<void> {
    let q = db.from("pipedrive_push_settings").update(values).eq("id", SETTINGS_ID);
    if (onlyIfDisabled) q = q.eq("enabled", false);
    const { error } = await q;
    check(error, "gravar a configuração da atualização do Pipedrive");
  }

  async function rpc(fn: string, args: Row, what: string): Promise<void> {
    const { error } = await db.rpc(fn, args);
    check(error, what);
  }

  return {
    async settings() {
      const { data, error } = await db
        .from("pipedrive_push_settings")
        .select("enabled, cursor")
        .eq("id", SETTINGS_ID)
        .maybeSingle();
      check(error, "ler a configuração da atualização do Pipedrive");
      const row = data as { enabled: boolean | null; cursor: string | null } | null;
      return { enabled: row?.enabled === true, cursor: row?.cursor ?? null };
    },

    async mirrorActive(now) {
      const job = await lastImport<{ mirror: boolean | null; finished_at: string }>("mirror, finished_at");
      return !!job?.mirror && Date.parse(job.finished_at) > now.getTime() - MIRROR_GUARD_MS;
    },

    async buildContext() {
      const job = await lastImport<ImportMaps>("mappings, cursor");
      if (!job) {
        throw new Error("Nenhuma importação do Pipedrive concluída: faltam os mapas de usuários, etapas e etiquetas.");
      }
      const m = job.mappings ?? {};
      const [dealFields, activityFields, activityTypes] = await Promise.all([
        client.dealFields(),
        client.activityFields(),
        client.activityTypes(),
      ]);

      // usuários: id no Pipedrive → perfil, ao contrário (vários usuários no mesmo perfil: o primeiro)
      const users = new Map<string, number>();
      for (const [pd, profile] of Object.entries(m.users ?? {})) {
        const id = Number(pd);
        if (typeof profile === "string" && Number.isFinite(id) && !users.has(profile)) users.set(profile, id);
      }

      // etiquetas de lead: etiqueta → empresa, ao contrário, sem as ignoradas (empresa removida do CRM)
      const ignored = new Set((m.ignoreLeadLabels ?? []).map(String));
      const labels = new Map<string, string>();
      for (const [label, company] of Object.entries(m.leadLabelCompany ?? {})) {
        if (typeof company === "string" && !ignored.has(label) && !labels.has(company)) labels.set(company, label);
      }

      // etapas: mesma precedência do importador (mapeamento, depois o cache dos funis criados por ele)
      const stages = new Map<string, number | null>();
      const cachedPipelines = job.cursor?.cache?.pipelines;

      // campos personalizados: só os do negócio (os únicos que a conversão envia), com o tipo e as opções de lá
      const customFields: PushCtx["customFields"] = [];
      for (const [pdKey, t] of Object.entries(m.customFields ?? {})) {
        const field = dealFields.find((f) => f.key === pdKey);
        const crmKey = t?.target === "custom" ? t.customFieldKey : t?.target?.startsWith("native:") ? t.target : null;
        if (!field || !crmKey) continue;
        const options: Record<string, string> = {};
        for (const o of field.options ?? []) {
          const label = String(o.label ?? "").trim();
          if (label && !(label in options)) options[label] = String(o.id);
        }
        customFields.push({
          crmKey,
          pdKey,
          type: field.field_type,
          ...(Object.keys(options).length ? { options } : {}),
        });
      }

      // tipos de atividade ativos: nome sem acento → key
      const types = activityTypes
        .filter((t) => t.active_flag !== false && typeof t.key_string === "string" && t.key_string)
        .map((t) => ({ name: norm(String(t.name ?? "")), key: String(t.key_string) }));
      const keys = new Set(types.map((t) => t.key));

      // resultado da reunião: opções do campo `outcome` das atividades
      const outcomes = (activityFields.find((f) => f.key === "outcome")?.options ?? [])
        .map((o) => ({ label: String(o.label ?? "").trim(), id: Number(o.id) }))
        .filter((o) => o.label && Number.isFinite(o.id));

      return {
        pdUserOf: (profileId) => (profileId ? (users.get(profileId) ?? null) : null),
        pdIdOf: (entity, crmId) => (crmId ? (links.get(linkKey(entity, crmId)) ?? null) : null),
        pdStageOf(stageId) {
          if (!stages.has(stageId)) stages.set(stageId, stagePipedriveIdFor(stageId, m.pipelines, cachedPipelines));
          return stages.get(stageId) ?? null;
        },
        pdLeadLabelOf: (companyId) => labels.get(companyId) ?? null,
        customFields,
        pdActivityTypeOf(typeName, isMeeting) {
          const name = norm(typeName);
          const byName = name ? types.find((t) => t.name === name) : undefined;
          if (byName) return byName.key;
          const alias = TYPE_ALIASES[name];
          if (alias && keys.has(alias)) return alias;
          return isMeeting ? "meeting" : "task";
        },
        pdOutcomeOf(label) {
          const wanted = label?.trim();
          if (!wanted) return null;
          const exact = outcomes.find((o) => o.label === wanted);
          if (exact) return exact.id;
          const key = norm(wanted);
          return outcomes.find((o) => norm(o.label) === key)?.id ?? null;
        },
      };
    },

    async changed(entity, since, limit, after) {
      const base = db.from(entity).select(PUSH_SELECT[entity]).is("deleted_at", null);
      const filtered = after
        ? base.or(`updated_at.gt.${quoted(since)},and(updated_at.eq.${quoted(since)},id.gt.${quoted(after)})`)
        : base.gt("updated_at", since);
      const { data, error } = await filtered.order("updated_at").order("id").limit(limit);
      check(error, `ler as mudanças de ${entity}`);
      const rows = (data ?? []) as unknown as Row[];
      await warm(entity, rows);
      return rows;
    },

    async deleted(entity, since) {
      const rows = await allPages<{ id: string; company_id: string }>(`ler as exclusões de ${entity}`, "id", (after) => {
        let q = db.from(entity).select("id, company_id").gt("deleted_at", since);
        if (after) q = q.gt("id", after);
        return q.order("id").limit(PAGE);
      });
      return rows.map((r) => ({ id: r.id, company_id: r.company_id }));
    },

    async retryQueue() {
      const out: { entity: PushEntity; record_id: string; company_id: string; attempts: number }[] = [];
      for (const entity of PUSH_ORDER) {
        const rows = await allPages<{ record_id: string; company_id: string; attempts: number }>(
          "ler a fila de retry",
          "record_id",
          (after) => {
            let q = db.from("pipedrive_push_retry").select("record_id, company_id, attempts").eq("entity", entity);
            if (after) q = q.gt("record_id", after);
            return q.order("record_id").limit(PAGE);
          },
        );
        for (const r of rows) {
          out.push({ entity, record_id: r.record_id, company_id: r.company_id, attempts: Number(r.attempts) });
        }
      }
      return out;
    },

    async loadOne(entity, id) {
      const { data, error } = await db
        .from(entity)
        .select(PUSH_SELECT[entity])
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      check(error, `ler o registro de ${entity}`);
      const row = data as unknown as Row | null;
      if (row) await warm(entity, [row]);
      return row;
    },

    async pdIdOf(entity, crmId) {
      const key = linkKey(entity, crmId);
      if (!links.has(key)) await loadLinks(entity, [crmId]);
      return links.get(key) ?? null;
    },

    async link(entity, pdId, companyId, recordId) {
      await rpc(
        "pipedrive_push_link",
        { p_entity: entity, p_external_id: pdId, p_company: companyId, p_record: recordId },
        "gravar o vínculo com o Pipedrive",
      );
      links.set(linkKey(entity, recordId), pdId);
    },

    async unlink(entity, recordId) {
      await rpc("pipedrive_push_unlink", { p_entity: entity, p_record: recordId }, "apagar o vínculo com o Pipedrive");
      links.set(linkKey(entity, recordId), null);
    },

    async queueRetry(entity, recordId, companyId, reason) {
      const found = await db
        .from("pipedrive_push_retry")
        .select("attempts")
        .eq("entity", entity)
        .eq("record_id", recordId)
        .maybeSingle();
      check(found.error, "ler a fila de retry");
      const values = { company_id: companyId, last_error: reason.slice(0, MAX_ERROR_CHARS), updated_at: new Date().toISOString() };
      const current = found.data as { attempts: number } | null;
      const { error } = current
        ? await db
            .from("pipedrive_push_retry")
            .update({ ...values, attempts: Number(current.attempts) + 1 })
            .eq("entity", entity)
            .eq("record_id", recordId)
        : await db.from("pipedrive_push_retry").insert({ ...values, entity, record_id: recordId, attempts: 1 });
      check(error, "gravar a fila de retry");
    },

    async clearRetry(entity, recordId) {
      const { error } = await db.from("pipedrive_push_retry").delete().eq("entity", entity).eq("record_id", recordId);
      check(error, "tirar o registro da fila de retry");
    },

    async startRun(cursorFrom) {
      const { data, error } = await db
        .from("pipedrive_push_runs")
        .insert({ cursor_from: cursorFrom, status: "running" })
        .select("id")
        .single();
      check(error, "abrir a rodada");
      return (data as { id: string }).id;
    },

    async finishRun(id, r) {
      const { error } = await db
        .from("pipedrive_push_runs")
        .update({
          status: r.status,
          finished_at: new Date().toISOString(),
          cursor_to: r.cursorTo,
          counters: r.counters,
          errors: r.errors,
        })
        .eq("id", id);
      check(error, "fechar a rodada");
    },

    async saveCursor(cursor) {
      await updateSettings({ cursor });
    },

    async setEnabled(enabled, now) {
      if (!enabled) return updateSettings({ enabled: false });
      const at = now.toISOString();
      // só a passagem de desligada para ligada move o cursor: ligar de novo não pula as mudanças ainda não enviadas
      await updateSettings({ enabled: true, enabled_at: at, cursor: at }, true);
    },
  };
}
