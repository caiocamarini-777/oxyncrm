import { describe, expect, it, vi } from "vitest";
import { PipedriveAuthError } from "../pipedrive/client";
import type { PdItem, PdPageEntity } from "../pipedrive/types";
import { MAX_FILE_BYTES, type EmailRow } from "./mapping";
import { runMailImport, type MailImportClient } from "./run";
import type { MailImportStore, RecordRef } from "./store";

vi.mock("server-only", () => ({}));

type FileRow = Parameters<MailImportStore["insertFile"]>[0];
type LinkEntity = Parameters<MailImportStore["linkEmail"]>[1];

const A = "empresa-a";
const B = "empresa-b";

type Source = {
  /** Tamanho das páginas do Pipedrive falso (pequeno para exercitar a paginação). */
  pageSize?: number;
  records?: Partial<Record<PdPageEntity, PdItem[]>>;
  /** Mensagens por registro ("persons/5"), soltas ou embrulhadas em `{ data }`. */
  mail?: Record<string, unknown[]>;
  mailErrors?: Record<string, Error>;
  bodies?: Record<number, string | Error>;
  files?: unknown[];
  downloads?: Record<number, Uint8Array | Error>;
  pageError?: Error;
  /** Espera de cada download (para medir a concorrência). */
  downloadDelayMs?: number;
};

/** Pipedrive falso em memória: registra as chamadas e responde pelos caminhos que o executor usa. */
function fakeClient(src: Source = {}) {
  const size = src.pageSize ?? 2;
  const calls = { pages: [] as string[], gets: [] as string[], downloads: [] as string[] };
  let active = 0;
  let maxActive = 0;
  const slice = <T>(all: T[], start: number) => ({
    items: all.slice(start, start + size),
    nextStart: start + size < all.length ? start + size : null,
  });
  const client: MailImportClient = {
    async page(entity, start) {
      calls.pages.push(`${entity}@${start}`);
      if (src.pageError) throw src.pageError;
      return slice(src.records?.[entity] ?? [], start);
    },
    async get(path) {
      calls.gets.push(path);
      const url = new URL(path, "https://pd.test");
      const start = Number(url.searchParams.get("start") ?? 0);
      const mail = /^\/v1\/(deals|persons|organizations)\/([^/]+)\/mailMessages$/.exec(url.pathname);
      if (mail) {
        const err = src.mailErrors?.[`${mail[1]}/${mail[2]}`];
        if (err) throw err;
        const s = slice(src.mail?.[`${mail[1]}/${mail[2]}`] ?? [], start);
        return { data: s.items, nextStart: s.nextStart };
      }
      const body = /^\/v1\/mailbox\/mailMessages\/(\d+)$/.exec(url.pathname);
      if (body) {
        const b = src.bodies?.[Number(body[1])];
        if (b instanceof Error) throw b;
        return { data: { id: Number(body[1]), body: b ?? `<p>corpo ${body[1]}</p>` }, nextStart: null };
      }
      if (url.pathname === "/v1/files") {
        const s = slice(src.files ?? [], start);
        return { data: s.items, nextStart: s.nextStart };
      }
      throw new Error(`caminho inesperado: ${path}`);
    },
    async download(path) {
      calls.downloads.push(path);
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        if (src.downloadDelayMs) await new Promise((r) => setTimeout(r, src.downloadDelayMs));
        const d = src.downloads?.[Number(/^\/v1\/files\/(\d+)\/download$/.exec(path)?.[1])];
        if (d instanceof Error) throw d;
        return { bytes: d ?? new Uint8Array([1, 2, 3]), contentType: "application/pdf" };
      } finally {
        active--;
      }
    },
  };
  return { client, calls, maxActive: () => maxActive };
}

/**
 * Store falso em memória. É estrito com os tipos dos ids (número para mensagem e arquivo do Pipedrive, texto para
 * registro): um id que chegou como texto e não foi normalizado vira erro do item.
 */
function fakeStore(init: {
  users?: Record<string, string>;
  records?: Record<string, RecordRef[]>;
  activities?: Record<string, { entity: LinkEntity; recordId: string }>;
} = {}) {
  const emails: { id: string; companyId: string; row: EmailRow }[] = [];
  const links: string[] = [];
  const files: FileRow[] = [];
  const uploads: { path: string; bytes: Uint8Array; mime: string | null }[] = [];
  const writes: string[] = [];
  let seq = 0;
  const num = (v: unknown, what: string) => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what} não numérico: ${String(v)}`);
  };
  const store: MailImportStore = {
    async userMap() {
      return init.users ?? {};
    },
    async recordsFor(entity, pdId) {
      if (typeof pdId !== "string") throw new Error("pdId não é texto");
      return init.records?.[`${entity}:${pdId}`] ?? [];
    },
    async activityRecord(activityId) {
      return init.activities?.[activityId] ?? null;
    },
    async emailId(companyId, pdMessageId) {
      num(pdMessageId, "id da mensagem");
      return emails.find((e) => e.companyId === companyId && e.row.pipedrive_id === pdMessageId)?.id ?? null;
    },
    async insertEmail(companyId, row) {
      writes.push("insertEmail");
      num(row.pipedrive_id, "pipedrive_id");
      if (row.pipedrive_thread_id !== null) num(row.pipedrive_thread_id, "pipedrive_thread_id");
      if (emails.some((e) => e.companyId === companyId && e.row.pipedrive_id === row.pipedrive_id)) {
        throw new Error("e-mail duplicado");
      }
      const id = `email-${++seq}`;
      emails.push({ id, companyId, row });
      return id;
    },
    async linkEmail(emailId, entity, recordId) {
      writes.push("linkEmail");
      const key = `${emailId}|${entity}|${recordId}`;
      if (links.includes(key)) return false;
      links.push(key);
      return true;
    },
    async hasFile(companyId, pdFileId) {
      num(pdFileId, "id do arquivo");
      return files.some((f) => f.company_id === companyId && f.pipedrive_id === pdFileId);
    },
    async insertFile(row) {
      writes.push("insertFile");
      num(row.pipedrive_id, "pipedrive_id do arquivo");
      if (files.some((f) => f.company_id === row.company_id && f.pipedrive_id === row.pipedrive_id)) {
        throw new Error("arquivo duplicado");
      }
      files.push(row);
    },
    async upload(path, bytes, mime) {
      writes.push("upload");
      uploads.push({ path, bytes, mime });
    },
  };
  return { store, emails, links, files, uploads, writes };
}

const ids = () => {
  let n = 0;
  return () => `f${++n}`;
};

const msg = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  mail_thread_id: 50,
  subject: `Assunto ${id}`,
  from: [{ email_address: "cliente@x.com", name: "Cliente" }],
  to: [{ email_address: "vendedor@oxyn.com", name: "Vendedor" }],
  message_time: "2026-10-01 12:00:00",
  user_id: 77,
  sent_flag: 0,
  ...extra,
});

const mailGets = (gets: string[]) => gets.filter((g) => /mailMessages\?start/.test(g));
const bodyGets = (gets: string[], id: number) => gets.filter((g) => g === `/v1/mailbox/mailMessages/${id}?include_body=1`);

describe("runMailImport — e-mails", () => {
  it("percorre negócios, pessoas e organizações e só lê as mensagens de quem tem e-mail, seguindo nextStart", async () => {
    const pd = fakeClient({
      records: {
        deals: [{ id: 1, email_messages_count: 0 }, { id: 2, email_messages_count: 1 }],
        persons: [{ id: 5, email_messages_count: 3 }, { id: 6, email_messages_count: 0 }, { id: 7, email_messages_count: 1 }],
        organizations: [{ id: 9, email_messages_count: 1 }],
      },
      mail: {
        "deals/2": [msg(200)],
        "persons/5": [msg(100), { data: msg(101) }, msg(102)],
        "persons/7": [{ data: msg(103) }],
        "organizations/9": [msg(104)],
      },
    });
    const db = fakeStore({
      records: {
        "deals:2": [{ companyId: A, recordId: "deal-2" }],
        "persons:5": [{ companyId: A, recordId: "pessoa-5" }],
        "persons:7": [{ companyId: A, recordId: "pessoa-7" }],
        "organizations:9": [{ companyId: A, recordId: "org-9" }],
      },
    });

    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });

    expect(pd.calls.pages).toEqual([
      "deals@0", "persons@0", "persons@2", "organizations@0",
    ]);
    expect(mailGets(pd.calls.gets)).toEqual([
      "/v1/deals/2/mailMessages?start=0&limit=100",
      "/v1/persons/5/mailMessages?start=0&limit=100",
      "/v1/persons/5/mailMessages?start=2&limit=100",
      "/v1/persons/7/mailMessages?start=0&limit=100",
      "/v1/organizations/9/mailMessages?start=0&limit=100",
    ]);
    expect(db.emails.map((e) => e.row.pipedrive_id).sort()).toEqual([100, 101, 102, 103, 104, 200]);
    expect(report.emails).toEqual({ created: 6, existing: 0, links: 6, noRecord: 0 });
    expect(report.errors).toEqual([]);
  });

  it("pessoa em duas empresas: uma linha de e-mail por empresa, cada uma com o seu vínculo, e o corpo buscado uma vez", async () => {
    const pd = fakeClient({
      records: { persons: [{ id: 5, email_messages_count: 1 }] },
      mail: { "persons/5": [msg(100)] },
      bodies: { 100: "<p>olá</p>" },
    });
    const db = fakeStore({
      users: { "77": "perfil-77" },
      records: { "persons:5": [{ companyId: A, recordId: "pa-5" }, { companyId: B, recordId: "pb-5" }] },
    });

    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });

    expect(report.emails).toEqual({ created: 2, existing: 0, links: 2, noRecord: 0 });
    expect(db.emails.map((e) => e.companyId)).toEqual([A, B]);
    const [ea, eb] = db.emails;
    expect(db.links).toEqual([`${ea.id}|persons|pa-5`, `${eb.id}|persons|pb-5`]);
    expect(bodyGets(pd.calls.gets, 100)).toHaveLength(1);
    expect(ea.row).toMatchObject({ pipedrive_id: 100, pipedrive_thread_id: 50, owner_id: "perfil-77", body_html: "<p>olá</p>" });
    expect(eb.row.body_html).toBe("<p>olá</p>");
  });

  it("mesma mensagem vista por outro registro da mesma empresa: nenhum e-mail novo, mais um vínculo", async () => {
    const pd = fakeClient({
      records: {
        persons: [{ id: 5, email_messages_count: 1 }],
        organizations: [{ id: 9, email_messages_count: 1 }],
      },
      mail: { "persons/5": [msg(100)], "organizations/9": [{ data: msg(100) }] },
    });
    const db = fakeStore({
      records: {
        "persons:5": [{ companyId: A, recordId: "pa-5" }],
        "organizations:9": [{ companyId: A, recordId: "oa-9" }],
      },
    });

    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });

    expect(report.emails).toEqual({ created: 1, existing: 1, links: 2, noRecord: 0 });
    expect(db.emails).toHaveLength(1);
    expect(db.links).toEqual([`${db.emails[0].id}|persons|pa-5`, `${db.emails[0].id}|organizations|oa-9`]);
    expect(bodyGets(pd.calls.gets, 100)).toHaveLength(1);
  });

  it("registro sem correspondente no CRM: não grava, nem lê as mensagens, e conta em noRecord", async () => {
    const pd = fakeClient({
      records: { persons: [{ id: 8, email_messages_count: 2 }] },
      mail: { "persons/8": [msg(100), msg(101)] },
    });
    const db = fakeStore();

    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });

    expect(report.emails).toEqual({ created: 0, existing: 0, links: 0, noRecord: 2 });
    expect(db.writes).toEqual([]);
    expect(mailGets(pd.calls.gets)).toEqual([]);
  });

  it("falha numa mensagem vai para errors e não para as outras", async () => {
    const pd = fakeClient({
      records: { persons: [{ id: 5, email_messages_count: 2 }, { id: 6, email_messages_count: 1 }] },
      mail: { "persons/5": [msg(100), msg(101)], "persons/6": [msg(102)] },
      mailErrors: { "persons/6": new Error("Pipedrive respondeu 500 em /v1/persons/6/mailMessages") },
      bodies: { 100: new Error("Falha de rede ao chamar o Pipedrive em /v1/mailbox/mailMessages/100") },
    });
    const db = fakeStore({
      records: {
        "persons:5": [{ companyId: A, recordId: "pa-5" }],
        "persons:6": [{ companyId: A, recordId: "pa-6" }],
      },
    });

    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });

    expect(db.emails.map((e) => e.row.pipedrive_id)).toEqual([101]);
    expect(report.errors).toEqual([
      { item: "e-mail 100", reason: "Falha de rede ao chamar o Pipedrive em /v1/mailbox/mailMessages/100" },
      { item: "pessoa 6", reason: "Pipedrive respondeu 500 em /v1/persons/6/mailMessages" },
    ]);
  });
});

describe("runMailImport — arquivos", () => {
  /** Mensagem 100 importada na empresa A pela pessoa 5; os arquivos vêm de `files`. */
  function scenario(files: unknown[], extra: Partial<Source> = {}) {
    const pd = fakeClient({
      records: { persons: [{ id: 5, email_messages_count: 1 }] },
      mail: { "persons/5": [msg(100)] },
      files,
      ...extra,
    });
    const db = fakeStore({
      users: { "77": "perfil-77" },
      records: {
        "persons:5": [{ companyId: A, recordId: "pa-5" }],
        "deals:2": [{ companyId: A, recordId: "deal-2" }],
        "activities:300": [{ companyId: A, recordId: "atividade-300" }],
      },
      activities: { "atividade-300": { entity: "persons", recordId: "pa-5" } },
    });
    return { pd, db };
  }

  it("percorre /v1/files sem os apagados, seguindo nextStart", async () => {
    const { pd, db } = scenario([
      { id: 1, inline_flag: 1, mail_message_id: 100 },
      { id: 2, inline_flag: 1, mail_message_id: 100 },
      { id: 3, inline_flag: 1, mail_message_id: 100 },
    ]);
    await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(pd.calls.gets.filter((g) => g.startsWith("/v1/files"))).toEqual([
      "/v1/files?start=0&limit=500&include_deleted_files=0",
      "/v1/files?start=2&limit=500&include_deleted_files=0",
    ]);
  });

  it("anexo de e-mail importado: baixa, envia ao bucket e grava ligado ao e-mail, com a data do Pipedrive", async () => {
    const { pd, db } = scenario([
      { id: 7, mail_message_id: 100, file_name: "proposta.pdf", file_size: 3, user_id: 77, add_time: "2025-05-10 08:30:00" },
      { id: 8, mail_message_id: 100, file_name: "planilha.xlsx", file_size: 3 },
    ], { downloads: { 7: new Uint8Array([1, 2, 3]), 8: new Uint8Array([4, 5, 6, 7]) } });

    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });

    const email = db.emails[0];
    expect(pd.calls.downloads).toEqual(["/v1/files/7/download", "/v1/files/8/download"]);
    expect(db.uploads.map((u) => [u.path, u.mime])).toEqual([
      [`${A}/pd-7/proposta.pdf`, "application/pdf"],
      [`${A}/pd-8/planilha.xlsx`, "application/pdf"],
    ]);
    expect(db.files[0]).toEqual({
      id: "f1",
      company_id: A,
      entity: null,
      record_id: null,
      email_id: email.id,
      pipedrive_id: 7,
      filename: "proposta.pdf",
      mime: "application/pdf",
      size: 3,
      storage_path: `${A}/pd-7/proposta.pdf`,
      remote_url: null,
      created_by: "perfil-77",
      created_at: "2025-05-10T08:30:00.000Z",
    });
    // sem add_time fica o padrão do banco
    expect(db.files[1]).not.toHaveProperty("created_at");
    expect(db.files[1]).toMatchObject({ email_id: email.id, size: 4, storage_path: `${A}/pd-8/planilha.xlsx` });
    expect(report.files).toMatchObject({ uploaded: 2, existing: 0 });
  });

  it("anexo de e-mail não importado: pulado e contado em noEmail, sem download", async () => {
    const { pd, db } = scenario([{ id: 7, mail_message_id: 999, file_name: "x.pdf", file_size: 3 }]);
    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(report.files.noEmail).toBe(1);
    expect(pd.calls.downloads).toEqual([]);
    expect(db.files).toEqual([]);
  });

  it("arquivo de card vai para o registro; o de atividade, para o registro vinculado à atividade", async () => {
    const { pd, db } = scenario([
      { id: 7, deal_id: 2, file_name: "contrato.pdf", file_size: 3 },
      { id: 8, activity_id: 300, file_name: "ata.pdf", file_size: 3 },
      { id: 9, deal_id: 404, file_name: "orfao.pdf", file_size: 3 },
      { id: 10, file_name: "solto.pdf", file_size: 3 },
    ]);
    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(db.files.map((f) => [f.pipedrive_id, f.entity, f.record_id, f.email_id])).toEqual([
      [7, "deals", "deal-2", null],
      [8, "persons", "pa-5", null],
    ]);
    expect(report.files).toMatchObject({ uploaded: 2, noTarget: 2 });
  });

  it("link externo grava só a URL; acima do limite grava só o nome; inline e .ics ficam de fora", async () => {
    const { pd, db } = scenario([
      { id: 7, person_id: 5, file_name: "doc", remote_location: "googledocs", url: "https://docs.google.com/x" },
      { id: 8, deal_id: 2, file_name: "video.mp4", file_size: MAX_FILE_BYTES + 1 },
      { id: 9, mail_message_id: 100, file_name: "logo.png", inline_flag: 1 },
      { id: 10, mail_message_id: 100, file_name: "convite.ics", file_size: 3 },
    ]);
    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(pd.calls.downloads).toEqual([]);
    expect(db.uploads).toEqual([]);
    expect(db.files.map((f) => [f.pipedrive_id, f.storage_path, f.remote_url, f.size])).toEqual([
      [7, null, "https://docs.google.com/x", null],
      [8, null, null, MAX_FILE_BYTES + 1],
    ]);
    expect(report.files).toEqual({
      uploaded: 0, remote: 1, tooLarge: 1, existing: 0, skippedInline: 1, skippedIcs: 1, noTarget: 0, noEmail: 0,
    });
  });

  it("link externo sem URL http(s) é pulado e conta em noTarget, sem gravar linha", async () => {
    const { pd, db } = scenario([
      { id: 7, person_id: 5, file_name: "doc", remote_location: "googledocs", url: null },
      { id: 8, person_id: 5, file_name: "doc2", remote_location: "googledocs" },
      { id: 9, person_id: 5, file_name: "doc3", remote_location: "gdrive", url: "javascript:alert(1)" },
    ]);
    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(db.files).toEqual([]);
    expect(pd.calls.downloads).toEqual([]);
    expect(report.files).toMatchObject({ remote: 0, noTarget: 3 });
    expect(report.errors).toEqual([]);
  });

  it("nome com acento e símbolos: caminho ASCII seguro e determinístico; filename fica o original", async () => {
    const files = [{ id: 7, deal_id: 2, file_name: "Orçamento #3?.pdf", file_size: 3 }];
    const { pd, db } = scenario(files);
    // o primeiro insert falha depois do envio (ex.: FK); a nova rodada envia para o mesmo objeto
    let failed = false;
    const flaky: MailImportStore = {
      ...db.store,
      async insertFile(row) {
        if (!failed) {
          failed = true;
          throw new Error("violação de FK");
        }
        return db.store.insertFile(row);
      },
    };

    const first = await runMailImport({ client: pd.client, store: flaky, newId: ids() });
    expect(first.errors).toEqual([{ item: "arquivo 7", reason: "violação de FK" }]);
    const second = await runMailImport({ client: pd.client, store: flaky, newId: ids() });
    expect(second.errors).toEqual([]);

    expect(db.uploads.map((u) => u.path)).toEqual([`${A}/pd-7/Orcamento__3_.pdf`, `${A}/pd-7/Orcamento__3_.pdf`]);
    expect(db.files.map((f) => [f.filename, f.storage_path])).toEqual([["Orçamento #3?.pdf", `${A}/pd-7/Orcamento__3_.pdf`]]);
  });

  it("add_time inválido deixa a data no padrão do banco", async () => {
    const { pd, db } = scenario([{ id: 7, deal_id: 2, file_name: "a.pdf", file_size: 3, add_time: "lixo" }]);
    await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(db.files).toHaveLength(1);
    expect(db.files[0]).not.toHaveProperty("created_at");
  });

  it("anexo de e-mail presente em duas empresas: baixa uma vez e grava um arquivo por empresa", async () => {
    const pd = fakeClient({
      records: { persons: [{ id: 5, email_messages_count: 1 }] },
      mail: { "persons/5": [msg(100)] },
      files: [{ id: 7, mail_message_id: 100, file_name: "proposta.pdf", file_size: 3 }],
    });
    const db = fakeStore({
      records: { "persons:5": [{ companyId: A, recordId: "pa-5" }, { companyId: B, recordId: "pb-5" }] },
    });
    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(pd.calls.downloads).toEqual(["/v1/files/7/download"]);
    expect(db.files.map((f) => [f.company_id, f.email_id, f.storage_path])).toEqual([
      [A, db.emails[0].id, `${A}/pd-7/proposta.pdf`],
      [B, db.emails[1].id, `${B}/pd-7/proposta.pdf`],
    ]);
    expect(report.files.uploaded).toBe(2);
  });

  it("falha num arquivo vai para errors e não para os outros; rodar de novo tenta outra vez", async () => {
    const files = [
      { id: 7, deal_id: 2, file_name: "a.pdf", file_size: 3 },
      { id: 8, deal_id: 2, file_name: "b.pdf", file_size: 3 },
    ];
    const { pd, db } = scenario(files, { downloads: { 7: new Error("Pipedrive respondeu 500 em /v1/files/7/download") } });

    const first = await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(first.errors).toEqual([{ item: "arquivo 7", reason: "Pipedrive respondeu 500 em /v1/files/7/download" }]);
    expect(db.files.map((f) => f.pipedrive_id)).toEqual([8]);
    expect(first.files.uploaded).toBe(1);

    const retry = fakeClient({ records: { persons: [{ id: 5, email_messages_count: 1 }] }, mail: { "persons/5": [msg(100)] }, files });
    const second = await runMailImport({ client: retry.client, store: db.store, newId: ids() });
    expect(second.errors).toEqual([]);
    expect(second.files).toMatchObject({ uploaded: 1, existing: 1 });
    expect(db.files.map((f) => f.pipedrive_id)).toEqual([8, 7]);
  });

  it("concurrency limita os downloads simultâneos", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ id: 10 + i, deal_id: 2, file_name: `${i}.pdf`, file_size: 3 }));
    const { pd, db } = scenario(files, { pageSize: 10, downloadDelayMs: 5 });
    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() }, { concurrency: 2 });
    expect(report.files.uploaded).toBe(6);
    expect(pd.maxActive()).toBe(2);
  });
});

describe("runMailImport — retomada, simulação e token", () => {
  function full() {
    const pd = fakeClient({
      records: {
        persons: [{ id: 5, email_messages_count: 1 }],
        organizations: [{ id: 9, email_messages_count: 1 }],
      },
      mail: { "persons/5": [msg(100)], "organizations/9": [msg(100)] },
      files: [
        { id: 7, mail_message_id: 100, file_name: "proposta.pdf", file_size: 3 },
        { id: 8, deal_id: 2, file_name: "contrato.pdf", file_size: 3 },
        { id: 9, person_id: 5, file_name: "doc", remote_location: "googledocs", url: "https://docs.google.com/x" },
        { id: 10, deal_id: 2, file_name: "video.mp4", file_size: MAX_FILE_BYTES + 1 },
        { id: 11, mail_message_id: 100, file_name: "logo.png", inline_flag: 1 },
      ],
    });
    const db = fakeStore({
      records: {
        "persons:5": [{ companyId: A, recordId: "pa-5" }, { companyId: B, recordId: "pb-5" }],
        "organizations:9": [{ companyId: A, recordId: "oa-9" }],
        "deals:2": [{ companyId: A, recordId: "deal-2" }],
      },
    });
    return { pd, db };
  }

  it("rodar duas vezes com o mesmo store não cria nada na segunda", async () => {
    const { pd, db } = full();
    const first = await runMailImport({ client: pd.client, store: db.store, newId: ids() });
    expect(first.emails).toEqual({ created: 2, existing: 1, links: 3, noRecord: 0 });
    expect(first.files).toMatchObject({ uploaded: 3, remote: 2, tooLarge: 1, existing: 0, skippedInline: 1 });
    const writesBefore = db.writes.length;

    const second = await runMailImport({ client: pd.client, store: db.store, newId: ids() });

    expect(second.emails).toEqual({ created: 0, existing: 3, links: 0, noRecord: 0 });
    expect(second.files).toMatchObject({ uploaded: 0, remote: 0, tooLarge: 0, existing: 6, skippedInline: 1 });
    expect(second.errors).toEqual([]);
    expect(db.writes.slice(writesBefore).filter((w) => w !== "linkEmail")).toEqual([]);
    expect(db.emails).toHaveLength(2);
    expect(db.files).toHaveLength(6);
    expect(bodyGets(pd.calls.gets, 100)).toHaveLength(1);
  });

  it("dryRun não grava nada, não busca corpo nem baixa, e conta o que seria feito", async () => {
    const { pd, db } = full();
    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() }, { dryRun: true });

    expect(db.writes).toEqual([]);
    expect(pd.calls.downloads).toEqual([]);
    expect(bodyGets(pd.calls.gets, 100)).toEqual([]);
    expect(report.emails).toEqual({ created: 2, existing: 1, links: 3, noRecord: 0 });
    expect(report.files).toEqual({
      uploaded: 3, remote: 2, tooLarge: 1, existing: 0, skippedInline: 1, skippedIcs: 0, noTarget: 0, noEmail: 0,
    });
    expect(report.errors).toEqual([]);
  });

  it("ids que chegam como texto são normalizados", async () => {
    const pd = fakeClient({
      records: { persons: [{ id: "5", email_messages_count: "1" }] },
      mail: { "persons/5": [{ data: { ...msg(0), id: "100", mail_thread_id: "50", user_id: "77" } }] },
      files: [
        { id: "7", mail_message_id: "100", file_name: "proposta.pdf", file_size: "3" },
        { id: "8", activity_id: "300", file_name: "ata.pdf", file_size: "3" },
      ],
    });
    const db = fakeStore({
      users: { "77": "perfil-77" },
      records: {
        "persons:5": [{ companyId: A, recordId: "pa-5" }],
        "activities:300": [{ companyId: A, recordId: "atividade-300" }],
      },
      activities: { "atividade-300": { entity: "persons", recordId: "pa-5" } },
    });

    const report = await runMailImport({ client: pd.client, store: db.store, newId: ids() });

    expect(report.errors).toEqual([]);
    expect(db.emails[0].row).toMatchObject({ pipedrive_id: 100, pipedrive_thread_id: 50, owner_id: "perfil-77" });
    expect(bodyGets(pd.calls.gets, 100)).toHaveLength(1);
    expect(db.files.map((f) => [f.pipedrive_id, f.email_id, f.entity])).toEqual([
      [7, db.emails[0].id, null],
      [8, null, "persons"],
    ]);
  });

  it("token inválido não é erro de item: propaga e encerra a importação", async () => {
    const listing = fakeClient({ pageError: new PipedriveAuthError() });
    await expect(runMailImport({ client: listing.client, store: fakeStore().store })).rejects.toBeInstanceOf(PipedriveAuthError);
    expect(listing.calls.pages).toEqual(["deals@0"]);

    const mail = fakeClient({
      records: { persons: [{ id: 5, email_messages_count: 1 }, { id: 6, email_messages_count: 1 }] },
      mailErrors: { "persons/5": new PipedriveAuthError() },
      files: [{ id: 7, deal_id: 2, file_size: 3 }],
    });
    const db = fakeStore({
      records: { "persons:5": [{ companyId: A, recordId: "pa-5" }], "persons:6": [{ companyId: A, recordId: "pa-6" }] },
    });
    await expect(runMailImport({ client: mail.client, store: db.store })).rejects.toBeInstanceOf(PipedriveAuthError);
    expect(mailGets(mail.calls.gets)).toEqual(["/v1/persons/5/mailMessages?start=0&limit=100"]);
    expect(mail.calls.gets.some((g) => g.startsWith("/v1/files"))).toBe(false);
  });

  it("token inválido no meio dos arquivos: para de listar e mantém os arquivos já gravados", async () => {
    const pd = fakeClient({
      records: { persons: [{ id: 5, email_messages_count: 1 }] },
      mail: { "persons/5": [msg(100)] },
      files: [
        { id: 7, mail_message_id: 100, file_name: "proposta.pdf", file_size: 3 },
        { id: 8, mail_message_id: 100, file_name: "outro.pdf", file_size: 3 },
        { id: 9, mail_message_id: 100, file_name: "depois.pdf", file_size: 3 },
      ],
      downloads: { 8: new PipedriveAuthError() },
    });
    const db = fakeStore({ records: { "persons:5": [{ companyId: A, recordId: "pa-5" }] } });

    await expect(
      runMailImport({ client: pd.client, store: db.store, newId: ids() }, { concurrency: 1 }),
    ).rejects.toBeInstanceOf(PipedriveAuthError);

    expect(pd.calls.gets.filter((g) => g.startsWith("/v1/files"))).toHaveLength(1);
    expect(db.files.map((f) => f.pipedrive_id)).toEqual([7]);
    expect(db.files[0].email_id).toBe(db.emails[0].id);
  });

  it("log recebe uma linha a cada 200 mensagens e a cada 200 arquivos", async () => {
    const pd = fakeClient({
      pageSize: 1000,
      records: { persons: [{ id: 5, email_messages_count: 200 }] },
      mail: { "persons/5": Array.from({ length: 200 }, (_, i) => msg(1000 + i)) },
      files: Array.from({ length: 400 }, (_, i) => ({ id: 5000 + i, inline_flag: 1 })),
    });
    const db = fakeStore({ records: { "persons:5": [{ companyId: A, recordId: "pa-5" }] } });
    const lines: string[] = [];
    await runMailImport({ client: pd.client, store: db.store, newId: ids(), log: (l) => lines.push(l) }, { dryRun: true });
    expect(lines.filter((l) => l.startsWith("E-mails:"))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("Arquivos:"))).toHaveLength(2);
  });
});
