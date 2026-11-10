import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { EmailRow } from "./mapping";
import { supabaseMailStore } from "./store";

type Call = { method: string; args: unknown[] };
type Query = { table: string; calls: Call[] };
type Result = { data?: unknown; error?: { message: string; code?: string } | null };

/**
 * Cliente Supabase falso mínimo: cada `from(tabela)` devolve um construtor que registra as chamadas encadeadas
 * (select, eq, insert...) e, ao ser aguardado, responde o que `respond` decidir olhando para elas. O Storage
 * registra o `upload` e devolve `uploadResult`.
 */
function fakeClient(respond: (q: Query) => Result = () => ({}), uploadResult: Result = { error: null }) {
  const queries: Query[] = [];
  const uploads: { bucket: string; path: string; bytes: Uint8Array; opts: unknown }[] = [];
  const db = {
    from(table: string) {
      const q: Query = { table, calls: [] };
      queries.push(q);
      const chain: unknown = new Proxy(
        {},
        {
          get(_t, method: string) {
            if (method === "then") {
              return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
                Promise.resolve({ data: null, error: null, ...respond(q) }).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              q.calls.push({ method, args });
              return chain;
            };
          },
        },
      );
      return chain;
    },
    storage: {
      from(bucket: string) {
        return {
          upload: async (path: string, bytes: Uint8Array, opts: unknown) => {
            uploads.push({ bucket, path, bytes, opts });
            return uploadResult;
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { db, queries, uploads, store: supabaseMailStore(db) };
}

const calls = (q: Query, method: string) => q.calls.filter((c) => c.method === method).map((c) => c.args);
const first = (q: Query, method: string) => calls(q, method)[0];
const did = (q: Query, method: string) => q.calls.some((c) => c.method === method);

const COMPANY = "11111111-1111-4111-8111-111111111111";
const RECORD = "22222222-2222-4222-8222-222222222222";
const EMAIL_ID = "33333333-3333-4333-8333-333333333333";

const row: EmailRow = {
  pipedrive_id: 10,
  pipedrive_thread_id: 7,
  owner_id: null,
  subject: "Proposta",
  from_email: "ana@cliente.com",
  from_name: "Ana",
  to: [{ email: "vendas@oxyn.com", name: null }],
  cc: [],
  sent_at: "2026-03-02T14:05:00.000Z",
  snippet: "Segue",
  body_html: "<p>Oi</p>",
  rfc_message_id: "<abc@cliente.com>",
  direction: "in",
};

describe("userMap", () => {
  /** O job responde `users`; `profiles` responde os ids que existem. */
  const withProfiles = (users: unknown, existing: string[] | { error: { message: string } }) =>
    fakeClient((q) => {
      if (q.table === "import_jobs") return { data: { mappings: { users, fallbackOwnerId: "x" } } };
      return Array.isArray(existing) ? { data: existing.map((id) => ({ id })) } : existing;
    });

  it("lê mappings.users do último job do Pipedrive concluído", async () => {
    const { store, queries } = withProfiles({ "1": "p1", "2": "p2" }, ["p1", "p2"]);
    expect(await store.userMap()).toEqual({ "1": "p1", "2": "p2" });
    const q = queries[0];
    expect(q.table).toBe("import_jobs");
    expect(calls(q, "eq")).toEqual(expect.arrayContaining([["source", "pipedrive"], ["status", "done"]]));
    expect(first(q, "order")?.[0]).toBe("finished_at");
    expect(first(q, "order")?.[1]).toMatchObject({ ascending: false });
    expect(first(q, "limit")).toEqual([1]);
  });

  it("fica só com os profiles que ainda existem, numa consulta só", async () => {
    const { store, queries } = withProfiles({ "1": "p1", "2": "apagado", "3": "p1" }, ["p1"]);
    expect(await store.userMap()).toEqual({ "1": "p1", "3": "p1" });
    expect(queries).toHaveLength(2);
    const q = queries[1];
    expect(q.table).toBe("profiles");
    expect(first(q, "select")).toEqual(["id"]);
    expect(calls(q, "in")).toEqual([["id", ["p1", "apagado"]]]);
  });

  it("sem job concluído ou sem usuários devolve um mapa vazio, sem consultar profiles", async () => {
    for (const data of [null, { mappings: {} }, { mappings: { users: null } }]) {
      const { store, queries } = fakeClient(() => ({ data }));
      expect(await store.userMap()).toEqual({});
      expect(queries.map((q) => q.table)).toEqual(["import_jobs"]);
    }
  });

  it("ignora valores que não são texto", async () => {
    const { store } = withProfiles({ "1": "p1", "2": 7, "3": null }, ["p1"]);
    expect(await store.userMap()).toEqual({ "1": "p1" });
  });

  it("erro ao conferir os profiles lança", async () => {
    const { store } = withProfiles({ "1": "p1" }, { error: { message: "boom" } });
    await expect(store.userMap()).rejects.toThrow("Falha ao conferir os perfis do mapa de usuários: boom");
  });

  it("erro do banco vira Error com a operação", async () => {
    const { store } = fakeClient(() => ({ error: { message: "boom" } }));
    await expect(store.userMap()).rejects.toThrow("Falha ao ler o mapa de usuários da importação: boom");
  });
});

describe("recordsFor", () => {
  it("consulta external_ids do Pipedrive pela entidade e pelo id e devolve um registro por empresa", async () => {
    const { store, queries } = fakeClient(() => ({
      data: [
        { company_id: COMPANY, record_id: RECORD },
        { company_id: "c2", record_id: "r2" },
      ],
    }));
    expect(await store.recordsFor("persons", "5")).toEqual([
      { companyId: COMPANY, recordId: RECORD },
      { companyId: "c2", recordId: "r2" },
    ]);
    const q = queries[0];
    expect(q.table).toBe("external_ids");
    expect(first(q, "select")?.[0]).toBe("company_id, record_id");
    expect(calls(q, "eq")).toEqual(
      expect.arrayContaining([["source", "pipedrive"], ["entity", "persons"], ["external_id", "5"]]),
    );
  });

  it("sem registro devolve lista vazia", async () => {
    expect(await fakeClient(() => ({ data: [] })).store.recordsFor("deals", "9")).toEqual([]);
    expect(await fakeClient(() => ({ data: null })).store.recordsFor("deals", "9")).toEqual([]);
  });

  it("erro do banco lança", async () => {
    const { store } = fakeClient(() => ({ error: { message: "boom" } }));
    await expect(store.recordsFor("deals", "9")).rejects.toThrow("Falha ao buscar os registros do CRM: boom");
  });
});

describe("activityRecord", () => {
  type Ids = { deal_id: string | null; lead_id: string | null; person_id: string | null; organization_id: string | null };
  const ids: Ids = { deal_id: null, lead_id: null, person_id: null, organization_id: null };
  const activity = (over: Partial<Ids>) => fakeClient(() => ({ data: { ...ids, ...over } }));

  it("lê a atividade pelo id", async () => {
    const { store, queries } = activity({ deal_id: "d1" });
    await store.activityRecord("a1");
    const q = queries[0];
    expect(q.table).toBe("activities");
    expect(first(q, "select")?.[0]).toBe("deal_id, lead_id, person_id, organization_id");
    expect(calls(q, "eq")).toEqual([["id", "a1"]]);
  });

  it("segue a precedência negócio, lead, pessoa, organização", async () => {
    const all = { deal_id: "d", lead_id: "l", person_id: "p", organization_id: "o" };
    expect(await activity(all).store.activityRecord("a")).toEqual({ entity: "deals", recordId: "d" });
    expect(await activity({ ...all, deal_id: null }).store.activityRecord("a")).toEqual({ entity: "leads", recordId: "l" });
    expect(await activity({ ...all, deal_id: null, lead_id: null }).store.activityRecord("a")).toEqual({
      entity: "persons",
      recordId: "p",
    });
    expect(await activity({ organization_id: "o" }).store.activityRecord("a")).toEqual({
      entity: "organizations",
      recordId: "o",
    });
  });

  it("atividade sem vínculo ou inexistente devolve null", async () => {
    expect(await activity({}).store.activityRecord("a")).toBeNull();
    expect(await fakeClient(() => ({ data: null })).store.activityRecord("a")).toBeNull();
  });
});

describe("emailId", () => {
  it("busca pela empresa e pelo id da mensagem no Pipedrive", async () => {
    const { store, queries } = fakeClient(() => ({ data: { id: EMAIL_ID } }));
    expect(await store.emailId(COMPANY, 10)).toBe(EMAIL_ID);
    const q = queries[0];
    expect(q.table).toBe("pipedrive_emails");
    expect(calls(q, "eq")).toEqual(expect.arrayContaining([["company_id", COMPANY], ["pipedrive_id", 10]]));
  });

  it("devolve null quando não existe", async () => {
    expect(await fakeClient(() => ({ data: null })).store.emailId(COMPANY, 10)).toBeNull();
  });
});

describe("insertEmail", () => {
  it("grava com a empresa e devolve o id", async () => {
    const { store, queries } = fakeClient(() => ({ data: { id: EMAIL_ID } }));
    expect(await store.insertEmail(COMPANY, row)).toBe(EMAIL_ID);
    const q = queries[0];
    expect(q.table).toBe("pipedrive_emails");
    expect(first(q, "insert")).toEqual([{ company_id: COMPANY, ...row }]);
    expect(first(q, "select")).toEqual(["id"]);
  });

  it("em conflito (23505) relê pelo (empresa, id do Pipedrive) e devolve o id existente", async () => {
    const { store, queries } = fakeClient((q) =>
      did(q, "insert") ? { error: { code: "23505", message: "duplicate key" } } : { data: { id: EMAIL_ID } },
    );
    expect(await store.insertEmail(COMPANY, row)).toBe(EMAIL_ID);
    expect(queries).toHaveLength(2);
    const reread = queries[1];
    expect(reread.table).toBe("pipedrive_emails");
    expect(did(reread, "insert")).toBe(false);
    expect(calls(reread, "eq")).toEqual(expect.arrayContaining([["company_id", COMPANY], ["pipedrive_id", 10]]));
  });

  it("conflito sem linha na releitura lança", async () => {
    const { store } = fakeClient((q) => (did(q, "insert") ? { error: { code: "23505", message: "duplicate key" } } : { data: null }));
    await expect(store.insertEmail(COMPANY, row)).rejects.toThrow("Falha ao gravar o e-mail 10");
  });

  it("outros erros lançam", async () => {
    const { store, queries } = fakeClient(() => ({ error: { code: "42501", message: "negado" } }));
    await expect(store.insertEmail(COMPANY, row)).rejects.toThrow("Falha ao gravar o e-mail 10: negado");
    expect(queries).toHaveLength(1);
  });
});

describe("linkEmail", () => {
  it("usa upsert ignorando duplicados e devolve true quando criou o vínculo", async () => {
    const { store, queries } = fakeClient(() => ({ data: [{ email_id: EMAIL_ID }] }));
    expect(await store.linkEmail(EMAIL_ID, "deals", RECORD)).toBe(true);
    const q = queries[0];
    expect(q.table).toBe("pipedrive_email_links");
    expect(first(q, "upsert")).toEqual([
      { email_id: EMAIL_ID, entity: "deals", record_id: RECORD },
      { onConflict: "email_id,entity,record_id", ignoreDuplicates: true },
    ]);
    expect(did(q, "select")).toBe(true);
  });

  it("devolve false quando o vínculo já existia", async () => {
    expect(await fakeClient(() => ({ data: [] })).store.linkEmail(EMAIL_ID, "deals", RECORD)).toBe(false);
    expect(await fakeClient(() => ({ data: null })).store.linkEmail(EMAIL_ID, "deals", RECORD)).toBe(false);
  });

  it("erro do banco lança", async () => {
    const { store } = fakeClient(() => ({ error: { message: "boom" } }));
    await expect(store.linkEmail(EMAIL_ID, "persons", RECORD)).rejects.toThrow("Falha ao vincular o e-mail: boom");
  });
});

describe("hasFile", () => {
  it("busca pela empresa e pelo id do arquivo no Pipedrive", async () => {
    const { store, queries } = fakeClient(() => ({ data: { id: "f1" } }));
    expect(await store.hasFile(COMPANY, 55)).toBe(true);
    const q = queries[0];
    expect(q.table).toBe("record_files");
    expect(calls(q, "eq")).toEqual(expect.arrayContaining([["company_id", COMPANY], ["pipedrive_id", 55]]));
  });

  it("devolve false quando não existe", async () => {
    expect(await fakeClient(() => ({ data: null })).store.hasFile(COMPANY, 55)).toBe(false);
  });

  it("erro do banco lança", async () => {
    const { store } = fakeClient(() => ({ error: { message: "boom" } }));
    await expect(store.hasFile(COMPANY, 55)).rejects.toThrow("Falha ao conferir o arquivo 55: boom");
  });
});

describe("insertFile", () => {
  const file = {
    id: "f1",
    company_id: COMPANY,
    entity: "deals",
    record_id: RECORD,
    email_id: null,
    pipedrive_id: 55,
    filename: "a.pdf",
    mime: "application/pdf",
    size: 10,
    storage_path: `${COMPANY}/pd-55/a.pdf`,
    remote_url: null,
    created_by: null,
  };

  it("insere a linha em record_files", async () => {
    const { store, queries } = fakeClient();
    await store.insertFile(file);
    expect(queries[0].table).toBe("record_files");
    expect(first(queries[0], "insert")).toEqual([file]);
  });

  it("leva a data do Pipedrive quando há", async () => {
    const { store, queries } = fakeClient();
    await store.insertFile({ ...file, created_at: "2025-05-10T08:30:00.000Z" });
    expect(first(queries[0], "insert")).toEqual([{ ...file, created_at: "2025-05-10T08:30:00.000Z" }]);
  });

  it("erro do banco lança", async () => {
    const { store } = fakeClient(() => ({ error: { message: "boom" } }));
    await expect(store.insertFile(file)).rejects.toThrow("Falha ao gravar o arquivo a.pdf: boom");
  });
});

describe("upload", () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it("envia ao bucket record-files com o tipo e sobrescrevendo", async () => {
    const { store, uploads } = fakeClient();
    await store.upload("c/f/a.pdf", bytes, "application/pdf");
    expect(uploads).toEqual([
      { bucket: "record-files", path: "c/f/a.pdf", bytes, opts: { contentType: "application/pdf", upsert: true } },
    ]);
  });

  it("sem tipo não informa contentType", async () => {
    const { store, uploads } = fakeClient();
    await store.upload("c/f/a.bin", bytes, null);
    expect(uploads[0].opts).toEqual({ contentType: undefined, upsert: true });
  });

  it("erro do Storage lança", async () => {
    const { store } = fakeClient(() => ({}), { error: { message: "sem espaço" } });
    await expect(store.upload("c/f/a.pdf", bytes, null)).rejects.toThrow("Falha ao enviar c/f/a.pdf ao Storage: sem espaço");
  });
});
