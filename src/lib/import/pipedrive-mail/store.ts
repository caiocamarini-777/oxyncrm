import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailRow } from "./mapping";

export type RecordRef = { companyId: string; recordId: string };
export type PdEntity = "deals" | "leads" | "persons" | "organizations" | "activities";
type LinkEntity = "deals" | "leads" | "persons" | "organizations";
type FileRow = {
  id: string;
  company_id: string;
  entity: string | null;
  record_id: string | null;
  email_id: string | null;
  pipedrive_id: number;
  filename: string;
  mime: string | null;
  size: number | null;
  storage_path: string | null;
  remote_url: string | null;
  created_by: string | null;
  /** Data do arquivo no Pipedrive (`add_time`); ausente fica o padrão do banco (`now()`). */
  created_at?: string;
};

/** Bucket privado dos arquivos importados (criado na migration). */
const BUCKET = "record-files";
/** Violação de chave única do Postgres. */
const UNIQUE_VIOLATION = "23505";

/**
 * Tudo que a importação de e-mails e arquivos do Pipedrive faz no banco e no Storage. O importador só conhece
 * esta interface, o que deixa os testes dele sem Supabase.
 */
export interface MailImportStore {
  /**
   * Mapa de usuários do Pipedrive (id em string) → profile, do último job de importação concluído, só com os
   * profiles que ainda existem (um profile apagado depois quebraria a FK de `owner_id` e `created_by`).
   */
  userMap(): Promise<Record<string, string>>;
  /** Registros do CRM (um por empresa) ligados a esse id do Pipedrive, pelo external_ids. */
  recordsFor(entity: PdEntity, pdId: string): Promise<RecordRef[]>;
  /** Registro vinculado de uma atividade do CRM (deal → lead → person → organization). */
  activityRecord(activityId: string): Promise<{ entity: LinkEntity; recordId: string } | null>;
  emailId(companyId: string, pdMessageId: number): Promise<string | null>;
  insertEmail(companyId: string, row: EmailRow): Promise<string>;
  /** true se criou o vínculo, false se ele já existia. */
  linkEmail(emailId: string, entity: LinkEntity, recordId: string): Promise<boolean>;
  hasFile(companyId: string, pdFileId: number): Promise<boolean>;
  insertFile(row: FileRow): Promise<void>;
  upload(path: string, bytes: Uint8Array, mime: string | null): Promise<void>;
}

type DbError = { message: string; code?: string } | null;

function check(error: DbError, what: string): void {
  if (error) throw new Error(`Falha ao ${what}: ${error.message}`);
}

/** Armazenamento da importação sobre o cliente admin (service_role, ignora o RLS). */
export function supabaseMailStore(db: SupabaseClient): MailImportStore {
  const findEmailId = async (companyId: string, pdMessageId: number): Promise<string | null> => {
    const r = await db
      .from("pipedrive_emails")
      .select("id")
      .eq("company_id", companyId)
      .eq("pipedrive_id", pdMessageId)
      .maybeSingle();
    check(r.error, `buscar o e-mail ${pdMessageId}`);
    return (r.data as { id: string } | null)?.id ?? null;
  };

  return {
    async userMap() {
      const r = await db
        .from("import_jobs")
        .select("mappings")
        .eq("source", "pipedrive")
        .eq("status", "done")
        .order("finished_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      check(r.error, "ler o mapa de usuários da importação");
      const users = (r.data as { mappings?: { users?: Record<string, unknown> | null } } | null)?.mappings?.users;
      const mapped: [string, string][] = [];
      for (const [pdId, profileId] of Object.entries(users ?? {})) {
        if (typeof profileId === "string") mapped.push([pdId, profileId]);
      }
      if (mapped.length === 0) return {};

      const p = await db.from("profiles").select("id").in("id", [...new Set(mapped.map(([, id]) => id))]);
      check(p.error, "conferir os perfis do mapa de usuários");
      const existing = new Set(((p.data ?? []) as { id: string }[]).map((x) => x.id));
      const out: Record<string, string> = {};
      for (const [pdId, profileId] of mapped) {
        if (existing.has(profileId)) out[pdId] = profileId;
      }
      return out;
    },

    async recordsFor(entity, pdId) {
      const r = await db
        .from("external_ids")
        .select("company_id, record_id")
        .eq("source", "pipedrive")
        .eq("entity", entity)
        .eq("external_id", pdId);
      check(r.error, "buscar os registros do CRM");
      return ((r.data ?? []) as { company_id: string; record_id: string }[]).map((x) => ({
        companyId: x.company_id,
        recordId: x.record_id,
      }));
    },

    async activityRecord(activityId) {
      const r = await db
        .from("activities")
        .select("deal_id, lead_id, person_id, organization_id")
        .eq("id", activityId)
        .maybeSingle();
      check(r.error, "ler a atividade do CRM");
      const a = r.data as { deal_id: string | null; lead_id: string | null; person_id: string | null; organization_id: string | null } | null;
      if (!a) return null;
      if (a.deal_id) return { entity: "deals", recordId: a.deal_id };
      if (a.lead_id) return { entity: "leads", recordId: a.lead_id };
      if (a.person_id) return { entity: "persons", recordId: a.person_id };
      if (a.organization_id) return { entity: "organizations", recordId: a.organization_id };
      return null;
    },

    emailId: findEmailId,

    async insertEmail(companyId, row) {
      const r = await db.from("pipedrive_emails").insert({ company_id: companyId, ...row }).select("id").single();
      if (r.error?.code === UNIQUE_VIOLATION) {
        // Outra rodada gravou a mesma mensagem: devolve a linha que já existe.
        const existing = await findEmailId(companyId, row.pipedrive_id);
        if (existing) return existing;
      }
      check(r.error, `gravar o e-mail ${row.pipedrive_id}`);
      return (r.data as { id: string }).id;
    },

    async linkEmail(emailId, entity, recordId) {
      // Com ignoreDuplicates o banco devolve só as linhas que criou: vazio quer dizer que o vínculo já existia.
      const r = await db
        .from("pipedrive_email_links")
        .upsert({ email_id: emailId, entity, record_id: recordId }, { onConflict: "email_id,entity,record_id", ignoreDuplicates: true })
        .select("email_id");
      check(r.error, "vincular o e-mail");
      return ((r.data ?? []) as unknown[]).length > 0;
    },

    async hasFile(companyId, pdFileId) {
      const r = await db
        .from("record_files")
        .select("id")
        .eq("company_id", companyId)
        .eq("pipedrive_id", pdFileId)
        .maybeSingle();
      check(r.error, `conferir o arquivo ${pdFileId}`);
      return r.data != null;
    },

    async insertFile(row) {
      const r = await db.from("record_files").insert(row);
      check(r.error, `gravar o arquivo ${row.filename}`);
    },

    async upload(path, bytes, mime) {
      const r = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime ?? undefined, upsert: true });
      check(r.error, `enviar ${path} ao Storage`);
    },
  };
}
