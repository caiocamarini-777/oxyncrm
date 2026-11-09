import { PipedriveAuthError, type PipedriveClient } from "../pipedrive/client";
import {
  classifyFile,
  fileAddedAt,
  fileName,
  type FileTarget,
  isRemoteFile,
  isWebUrl,
  mapMailMessage,
  MAX_FILE_BYTES,
  type PdFile,
  type PdMailMessage,
  storagePath,
} from "./mapping";
import type { MailImportStore, RecordRef } from "./store";

/**
 * Importação dos e-mails e arquivos guardados no Pipedrive (spec 2026-11-09, "Fluxo da importação" e "Erros").
 *
 * 1. **E-mails:** percorre negócios, pessoas e organizações com `email_messages_count > 0` e lê as mensagens de
 *    cada um. Cada mensagem vira uma linha por empresa em que o registro existe no CRM, com o vínculo ao registro;
 *    a mesma mensagem vista por outro registro só ganha mais um vínculo. O corpo é buscado uma vez por mensagem,
 *    só quando alguma empresa ainda não tem o e-mail. Registro sem correspondente no CRM nem tem as mensagens
 *    lidas: cada uma conta em `noRecord`.
 * 2. **Arquivos:** percorre `/v1/files` (sem os apagados). O anexo de e-mail vai para cada empresa em que a
 *    mensagem existe, conforme o passo 1 desta mesma rodada (que relê todas as mensagens, inclusive as já
 *    importadas). O arquivo de card vai para o registro; o de atividade, para o registro vinculado à atividade.
 *    Link externo grava só a URL (sem URL http(s), é pulado e conta em `noTarget`); arquivo acima do limite do
 *    bucket, só o nome. Um download serve a todas as empresas do arquivo. A data do arquivo é o `add_time`.
 *
 * Reexecutável: e-mail e arquivo já gravados são pulados pelo id do Pipedrive (`emailId`, `hasFile`). O envio ao
 * bucket vem antes do `insertFile`, para que uma falha no meio deixe o arquivo para a próxima rodada; o caminho
 * no bucket é determinístico (`storagePath`), então a nova tentativa sobrescreve o mesmo objeto. Falha num
 * item vai para `errors` e não para o resto; token inválido (`PipedriveAuthError`) encerra a importação.
 * `dryRun` só lê e conta: não grava, não busca corpo nem baixa arquivo.
 */

export type MailImportClient = Pick<PipedriveClient, "page" | "get" | "download">;

export type MailImportReport = {
  emails: { created: number; existing: number; links: number; noRecord: number };
  files: {
    uploaded: number;
    remote: number;
    tooLarge: number;
    existing: number;
    skippedInline: number;
    skippedIcs: number;
    noTarget: number;
    noEmail: number;
  };
  errors: { item: string; reason: string }[];
};

type FileRow = Parameters<MailImportStore["insertFile"]>[0];
type LinkEntity = Parameters<MailImportStore["linkEmail"]>[1];
type MailEntity = "deals" | "persons" | "organizations";

/** Onde um arquivo é gravado numa empresa: ligado ao e-mail (anexo) ou ao registro (arquivo do card). */
type FileDestination = {
  companyId: string;
  entity: LinkEntity | null;
  recordId: string | null;
  emailId: string | null;
};

const MAIL_ENTITIES: MailEntity[] = ["deals", "persons", "organizations"];
const ITEM_LABEL: Record<MailEntity, { one: string; many: string }> = {
  deals: { one: "negócio", many: "negócios" },
  persons: { one: "pessoa", many: "pessoas" },
  organizations: { one: "organização", many: "organizações" },
};
const MAIL_PAGE = 100;
const FILES_PAGE = 500;
const LOG_EVERY = 200;

/** Número de um id ou contador do Pipedrive, que pode vir como texto; vazio ou inválido: null. */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Limitador simples: no máximo `max` tarefas ao mesmo tempo; quem termina passa a vaga direto para a próxima. */
function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => queue.push(resolve));
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Mensagem da lista do Pipedrive, solta ou embrulhada em `{ data }` conforme a versão, com os ids como número. */
function toMessage(item: unknown): PdMailMessage | null {
  const raw = (item as { data?: unknown } | null)?.data ?? item;
  if (!raw || typeof raw !== "object") return null;
  const m = raw as PdMailMessage;
  const id = toNum(m.id);
  return id === null ? null : { ...m, id, mail_thread_id: toNum(m.mail_thread_id) };
}

function toFile(item: unknown): PdFile | null {
  if (!item || typeof item !== "object") return null;
  const f = item as PdFile;
  const id = toNum(f.id);
  return id === null ? null : { ...f, id };
}

/** Sem repetidos na mesma página: os itens de uma página rodam em paralelo e não podem disputar a mesma chave. */
function uniqueById<T extends { id: number }>(items: (T | null)[]): T[] {
  const byId = new Map<number, T>();
  for (const it of items) if (it && !byId.has(it.id)) byId.set(it.id, it);
  return [...byId.values()];
}

/** Próximo `start` da paginação; `null` quando acabou ou quando o Pipedrive não avança (evita laço infinito). */
const nextOf = (nextStart: number | null, start: number): number | null =>
  nextStart !== null && nextStart > start ? nextStart : null;

export async function runMailImport(
  deps: { client: MailImportClient; store: MailImportStore; newId?: () => string; log?: (msg: string) => void },
  opts: { dryRun?: boolean; concurrency?: number } = {},
): Promise<MailImportReport> {
  const { client, store } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const log = deps.log ?? (() => {});
  const dryRun = opts.dryRun ?? false;
  const limit = limiter(Math.max(1, Math.floor(opts.concurrency ?? 4)));
  const report: MailImportReport = {
    emails: { created: 0, existing: 0, links: 0, noRecord: 0 },
    files: { uploaded: 0, remote: 0, tooLarge: 0, existing: 0, skippedInline: 0, skippedIcs: 0, noTarget: 0, noEmail: 0 },
    errors: [],
  };
  /** Token inválido visto: as tarefas ainda na fila desistem sem chamar o Pipedrive. */
  let fatal: unknown = null;

  /** Erro do item vai para o relatório; token inválido sobe e encerra a importação. */
  async function guard(item: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (err instanceof PipedriveAuthError) {
        fatal ??= err;
        throw err;
      }
      report.errors.push({ item, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Roda as tarefas de uma página com o limite de concorrência e espera todas antes de seguir. */
  async function runAll(tasks: (() => Promise<void>)[]): Promise<void> {
    const results = await Promise.allSettled(tasks.map((t) => limit(() => (fatal ? Promise.reject(fatal) : t()))));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
  }

  const users = await store.userMap();
  const userOf = (pdUserId: unknown): string | null => users[String(pdUserId)] ?? null;

  // ---- 1. E-mails ----

  /** Mensagem do Pipedrive → empresa → id do e-mail no CRM (em `dryRun`, um id simulado). Base do passo 2. */
  const emails = new Map<number, Map<string, string>>();
  const simulatedLinks = new Set<string>();
  let messagesSeen = 0;

  async function fetchBody(pdMessageId: number): Promise<string | null> {
    const { data } = await client.get(`/v1/mailbox/mailMessages/${pdMessageId}?include_body=1`);
    const body = (data as { body?: unknown } | null)?.body;
    return typeof body === "string" ? body : null;
  }

  /** true se o vínculo é novo. Em `dryRun`, novo é o que ainda não foi contado nesta rodada. */
  async function link(emailId: string, entity: LinkEntity, recordId: string): Promise<boolean> {
    if (!dryRun) return store.linkEmail(emailId, entity, recordId);
    const key = `${emailId}|${entity}|${recordId}`;
    if (simulatedLinks.has(key)) return false;
    simulatedLinks.add(key);
    return true;
  }

  async function importMessage(entity: MailEntity, refs: RecordRef[], m: PdMailMessage): Promise<void> {
    if (++messagesSeen % LOG_EVERY === 0) {
      log(`E-mails: ${messagesSeen} mensagens lidas (${report.emails.created} novos, ${report.emails.existing} já existentes)`);
    }
    const byCompany = emails.get(m.id) ?? new Map<string, string>();
    emails.set(m.id, byCompany);
    let body: string | null | undefined;
    for (const ref of refs) {
      let emailId = byCompany.get(ref.companyId) ?? (await store.emailId(ref.companyId, m.id));
      if (emailId) {
        report.emails.existing++;
      } else {
        if (dryRun) {
          emailId = `simulado:${ref.companyId}:${m.id}`;
        } else {
          if (body === undefined) body = await fetchBody(m.id);
          emailId = await store.insertEmail(ref.companyId, mapMailMessage(m, { ownerId: userOf(m.user_id), body }));
        }
        report.emails.created++;
      }
      byCompany.set(ref.companyId, emailId);
      if (await link(emailId, entity, ref.recordId)) report.emails.links++;
    }
  }

  async function importRecordMail(entity: MailEntity, pdId: string, count: number): Promise<void> {
    const refs = await store.recordsFor(entity, pdId);
    if (refs.length === 0) {
      report.emails.noRecord += count;
      return;
    }
    for (let start: number | null = 0; start !== null; ) {
      const page = await client.get(`/v1/${entity}/${pdId}/mailMessages?start=${start}&limit=${MAIL_PAGE}`);
      const messages = uniqueById((Array.isArray(page.data) ? page.data : []).map(toMessage));
      await runAll(messages.map((m) => () => guard(`e-mail ${m.id}`, () => importMessage(entity, refs, m))));
      start = nextOf(page.nextStart, start);
    }
  }

  for (const entity of MAIL_ENTITIES) {
    await guard(`lista de ${ITEM_LABEL[entity].many}`, async () => {
      for (let start: number | null = 0; start !== null; ) {
        const page = await client.page(entity, start);
        for (const item of page.items) {
          const pdId = toNum(item.id);
          const count = toNum(item.email_messages_count) ?? 0;
          if (pdId === null || count <= 0) continue;
          await guard(`${ITEM_LABEL[entity].one} ${pdId}`, () => importRecordMail(entity, String(pdId), count));
        }
        start = nextOf(page.nextStart, start);
      }
    });
  }

  // ---- 2. Arquivos ----

  let filesSeen = 0;

  async function destinations(target: Exclude<FileTarget, { kind: "skip" }>): Promise<FileDestination[]> {
    if (target.kind === "email") {
      const pdMessageId = Number(target.pdMessageId);
      return [...(emails.get(pdMessageId) ?? new Map<string, string>())].map(([companyId, emailId]) => ({
        companyId, entity: null, recordId: null, emailId,
      }));
    }
    // um destino por empresa (a chave única do arquivo é empresa + id do Pipedrive)
    const out: FileDestination[] = [];
    const add = (companyId: string, entity: LinkEntity, recordId: string) => {
      if (!out.some((d) => d.companyId === companyId)) out.push({ companyId, entity, recordId, emailId: null });
    };
    if (target.kind === "record") {
      for (const r of await store.recordsFor(target.entity, target.pdId)) add(r.companyId, target.entity, r.recordId);
      return out;
    }
    for (const r of await store.recordsFor("activities", String(target.pdActivityId))) {
      if (out.some((d) => d.companyId === r.companyId)) continue;
      const rec = await store.activityRecord(r.recordId);
      if (rec) add(r.companyId, rec.entity, rec.recordId);
    }
    return out;
  }

  async function importFile(f: PdFile): Promise<void> {
    if (++filesSeen % LOG_EVERY === 0) {
      log(`Arquivos: ${filesSeen} lidos (${report.files.uploaded} enviados, ${report.files.existing} já existentes)`);
    }
    const target = classifyFile(f);
    if (target.kind === "skip") {
      if (target.reason === "inline") report.files.skippedInline++;
      else if (target.reason === "ics") report.files.skippedIcs++;
      else report.files.noTarget++;
      return;
    }
    // link externo sem URL que dê para abrir: não vira linha (a tela diria que passou de 25 MB)
    if (isRemoteFile(f) && !isWebUrl(f.url)) {
      report.files.noTarget++;
      return;
    }
    const dests = await destinations(target);
    if (dests.length === 0) {
      if (target.kind === "email") report.files.noEmail++;
      else report.files.noTarget++;
      return;
    }
    const name = fileName(f);
    const addedAt = fileAddedAt(f);
    const declaredSize = toNum(f.file_size);
    let download: ReturnType<MailImportClient["download"]> | undefined;
    for (const d of dests) {
      if (await store.hasFile(d.companyId, f.id)) {
        report.files.existing++;
        continue;
      }
      const id = newId();
      const row: FileRow = {
        id,
        company_id: d.companyId,
        entity: d.entity,
        record_id: d.recordId,
        email_id: d.emailId,
        pipedrive_id: f.id,
        filename: name,
        mime: null,
        size: declaredSize,
        storage_path: null,
        remote_url: null,
        created_by: userOf(f.user_id),
      };
      if (addedAt) row.created_at = addedAt;
      let kind: "uploaded" | "remote" | "tooLarge";
      if (isRemoteFile(f)) {
        kind = "remote";
        row.remote_url = f.url ?? null;
      } else if (declaredSize !== null && declaredSize > MAX_FILE_BYTES) {
        kind = "tooLarge";
      } else {
        kind = "uploaded";
        if (!dryRun) {
          download ??= client.download(`/v1/files/${f.id}/download`);
          const { bytes, contentType } = await download;
          row.size = bytes.byteLength;
          row.mime = contentType;
          // sem file_size no Pipedrive, o tamanho real só se sabe depois de baixar
          if (bytes.byteLength > MAX_FILE_BYTES) {
            kind = "tooLarge";
          } else {
            row.storage_path = storagePath(d.companyId, f.id, name);
            await store.upload(row.storage_path, bytes, contentType);
          }
        }
      }
      if (!dryRun) await store.insertFile(row);
      report.files[kind]++;
    }
  }

  await guard("lista de arquivos", async () => {
    for (let start: number | null = 0; start !== null; ) {
      const page = await client.get(`/v1/files?start=${start}&limit=${FILES_PAGE}&include_deleted_files=0`);
      const files = uniqueById((Array.isArray(page.data) ? page.data : []).map(toFile));
      await runAll(files.map((f) => () => guard(`arquivo ${f.id}`, () => importFile(f))));
      start = nextOf(page.nextStart, start);
    }
  });

  return report;
}
