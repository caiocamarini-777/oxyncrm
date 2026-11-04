import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GmailApiError, GmailAuthError, GmailHistoryExpiredError, GmailRateLimitError } from "./client";
import type { ContactIndex } from "./matcher";
import type { GmailMessage } from "./parse";
import type { AccountPatch, SyncStore } from "./store";
import { type SyncClient, syncAccount } from "./sync";
import { encodeCursor, type SyncAccount } from "./sync-core";

const NOW = new Date("2026-11-04T15:00:00Z");
const now = () => NOW.getTime();
const deadline = NOW.getTime() + 60_000;

const index: ContactIndex = {
  personsByEmail: new Map([["maria@acme.com", [{ id: "p1", organizationId: "o1" }]]]),
  orgsByDomain: new Map(),
  openLeads: [{ id: "l1", personId: "p1", organizationId: null }],
  openDeals: [],
};

/** Mensagem do Gmail com a forma de metadata (sem corpo) ou full (com corpo). */
function msg(id: string, threadId: string, from: string, to: string, over: Partial<GmailMessage> = {}, full = false): GmailMessage {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  return {
    id,
    threadId,
    historyId: "9",
    internalDate: String(NOW.getTime() - 1000),
    snippet: "trecho",
    labelIds: ["INBOX"],
    payload: {
      mimeType: full ? "multipart/alternative" : "text/plain",
      headers: [
        { name: "From", value: from },
        { name: "To", value: to },
        { name: "Subject", value: "Proposta" },
        { name: "Message-ID", value: `<${id}@x>` },
      ],
      ...(full
        ? { parts: [{ mimeType: "text/plain", body: { data: b64("corpo") } }, { mimeType: "text/html", body: { data: b64("<p>corpo</p>") } }] }
        : {}),
    },
    ...over,
  };
}

type Row = { id: string; threadId: string; from: string; to: string; labelIds?: string[]; gone?: boolean };

class FakeGmail implements SyncClient {
  rows = new Map<string, Row>();
  pages: { ids: string[] }[] = [];
  history: { ids: string[] }[] = [];
  historyError: Error | null = null;
  profileHistoryId = "100";
  calls = { metadata: 0, full: 0, list: [] as { q?: string; pageToken?: string }[], history: [] as string[] };
  failIds = new Set<string>();
  fatalOn: Error | null = null;

  add(r: Row) {
    this.rows.set(r.id, r);
  }
  ref(id: string) {
    return { id, threadId: this.rows.get(id)!.threadId };
  }
  async getProfile() {
    return { emailAddress: "ana@oxyn.com", historyId: this.profileHistoryId };
  }
  async listMessages(opts: { q?: string; pageToken?: string; maxResults?: number }) {
    this.calls.list.push({ q: opts.q, pageToken: opts.pageToken });
    const i = opts.pageToken ? Number(opts.pageToken) : 0;
    const page = this.pages[i] ?? { ids: [] };
    return { messages: page.ids.map((id) => this.ref(id)), nextPageToken: i + 1 < this.pages.length ? String(i + 1) : undefined };
  }
  async getMessage(id: string, format: "metadata" | "full") {
    if (this.fatalOn) throw this.fatalOn;
    const r = this.rows.get(id)!;
    if (r.gone) throw new GmailApiError(404, "not found");
    if (this.failIds.has(id)) throw new GmailApiError(500, "boom");
    if (format === "metadata") this.calls.metadata++;
    else this.calls.full++;
    return msg(id, r.threadId, r.from, r.to, { labelIds: r.labelIds ?? ["INBOX"] }, format === "full");
  }
  async listHistory(opts: { startHistoryId: string; pageToken?: string }) {
    this.calls.history.push(opts.startHistoryId);
    if (this.historyError) throw this.historyError;
    const i = opts.pageToken ? Number(opts.pageToken) : 0;
    const page = this.history[i] ?? { ids: [] };
    return {
      history: page.ids.map((id) => ({ messagesAdded: [{ message: this.ref(id) }] })),
      historyId: "200",
      nextPageToken: i + 1 < this.history.length ? String(i + 1) : undefined,
    };
  }
}

/** Banco em memória com as mesmas chaves únicas e a mesma regra de vínculo da `store.ts` real. */
class FakeStore implements SyncStore {
  threads = new Map<string, { id: string; subject: string; last: string | null }>();
  messages = new Map<string, { thread: string; direction: string; html: string | null; to: unknown }>();
  links = new Map<string, { origin: string; unlinked_at: string | null }>();
  patches: AccountPatch[] = [];
  storeCalls = 0;

  async updateAccount(_id: string, patch: AccountPatch) {
    this.patches.push(patch);
  }
  async storedMessageIds(_a: string, ids: string[]) {
    return new Set(ids.filter((i) => this.messages.has(i)));
  }
  async storedThreadIds(_a: string, ids: string[]) {
    return new Set(ids.filter((i) => this.threads.has(i)));
  }
  async storeMessage(account: SyncAccount, p: Parameters<SyncStore["storeMessage"]>[1], links: Parameters<SyncStore["storeMessage"]>[2]) {
    this.storeCalls++;
    const t = this.threads.get(p.threadId) ?? { id: `thr-${p.threadId}`, subject: p.subject, last: null };
    if (!t.last || p.sentAt > t.last) t.last = p.sentAt;
    this.threads.set(p.threadId, t);
    this.messages.set(p.gmailId, {
      thread: t.id,
      direction: p.from.email === account.email ? "out" : "in",
      html: p.html,
      to: p.to,
    });
    let inserted = 0;
    for (const l of links) {
      const k = `${t.id}:${l.entity}:${l.recordId}`;
      if (this.links.has(k)) continue; // on conflict do nothing (não mexe em unlinked_at)
      this.links.set(k, { origin: "auto", unlinked_at: null });
      inserted++;
    }
    return { linksInserted: inserted };
  }
}

const account = (over: Partial<SyncAccount> = {}): SyncAccount => ({
  id: "acc1",
  company_id: "co1",
  email: "ana@oxyn.com",
  history_id: null,
  backfill_page_token: null,
  backfill_done: false,
  ...over,
});

let gmail: FakeGmail;
let store: FakeStore;
const run = (acc: SyncAccount, over: { deadline?: number; loadIndex?: () => Promise<ContactIndex> } = {}) =>
  syncAccount(acc, { client: gmail, store, loadIndex: over.loadIndex ?? (async () => index), deadline: over.deadline ?? deadline, now });

beforeEach(() => {
  gmail = new FakeGmail();
  store = new FakeStore();
});

describe("primeira carga", () => {
  it("grava o history_id do perfil, usa 12 meses e só grava mensagens com vínculo", async () => {
    gmail.add({ id: "m1", threadId: "t1", from: "Maria <maria@acme.com>", to: "ana@oxyn.com" });
    gmail.add({ id: "m2", threadId: "t2", from: "alguem@desconhecido.com", to: "ana@oxyn.com" });
    gmail.pages = [{ ids: ["m1", "m2"] }];

    const r = await run(account());

    expect(store.patches[0]).toEqual({ history_id: "100" });
    expect(gmail.calls.list[0].q).toBe("after:2025/11/04 -in:chats -in:spam -in:trash");
    expect(r).toMatchObject({ processed: 2, stored: 1, linked: 3, errors: 0, phase: "backfill", complete: true });
    expect([...store.messages.keys()]).toEqual(["m1"]);
    expect(store.messages.get("m1")).toMatchObject({ direction: "in", html: "<p>corpo</p>" });
    expect(gmail.calls.full).toBe(1); // m2 não vai para full
    expect(store.patches).toContainEqual(expect.objectContaining({ backfill_done: true, backfill_page_token: null }));
  });

  it("não sobrescreve o history_id existente", async () => {
    gmail.pages = [{ ids: [] }];
    await run(account({ history_id: "55" }));
    expect(store.patches.some((p) => "history_id" in p)).toBe(false);
  });

  it("pagina guardando o cursor e continua dele na execução seguinte", async () => {
    for (const id of ["a", "b", "c"]) gmail.add({ id, threadId: `t${id}`, from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.pages = [{ ids: ["a"] }, { ids: ["b"] }, { ids: ["c"] }];

    // para depois da primeira página: o relógio avança a cada consulta de lista
    let ticks = 0;
    const tick = vi.fn(() => (ticks++ < 4 ? NOW.getTime() : NOW.getTime() + 61_000));
    const partial = await syncAccount(account(), { client: gmail, store, loadIndex: async () => index, deadline, now: tick });
    expect(partial.complete).toBe(false);
    const saved = store.patches.filter((p) => p.backfill_page_token).at(-1)!.backfill_page_token!;
    expect(saved).toBe(encodeCursor("2025/11/04", "1"));

    const rest = await run(account({ history_id: "100", backfill_page_token: saved }));
    expect(rest.complete).toBe(true);
    expect(gmail.calls.list.at(-1)).toEqual({ q: "after:2025/11/04 -in:chats -in:spam -in:trash", pageToken: "2" });
  });

  it("deduplica ids repetidos no lote", async () => {
    gmail.add({ id: "m1", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.pages = [{ ids: ["m1", "m1"] }];
    const r = await run(account());
    expect(r.processed).toBe(1);
    expect(store.storeCalls).toBe(1);
  });

  it("direção out quando o remetente é a caixa", async () => {
    gmail.add({ id: "m1", threadId: "t1", from: "Ana <ana@oxyn.com>", to: "maria@acme.com" });
    gmail.pages = [{ ids: ["m1"] }];
    await run(account());
    expect(store.messages.get("m1")?.direction).toBe("out");
  });

  it("ignora spam/rascunho, mensagem apagada e carrega o índice só se necessário", async () => {
    gmail.add({ id: "s", threadId: "ts", from: "maria@acme.com", to: "ana@oxyn.com", labelIds: ["SPAM"] });
    gmail.add({ id: "g", threadId: "tg", from: "maria@acme.com", to: "ana@oxyn.com", gone: true });
    gmail.pages = [{ ids: ["s", "g"] }];
    const r = await run(account());
    expect(r).toMatchObject({ stored: 0, errors: 0, complete: true });
  });

  it("falha numa mensagem: conta o erro, segue com as outras e não avança o cursor", async () => {
    gmail.add({ id: "bad", threadId: "tb", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.add({ id: "ok", threadId: "to", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.failIds.add("bad");
    gmail.pages = [{ ids: ["bad", "ok"] }, { ids: [] }];
    const r = await run(account());
    expect(r).toMatchObject({ stored: 1, errors: 1, complete: false });
    expect(r.lastError).toContain("bad");
    expect(store.patches.some((p) => p.backfill_done)).toBe(false);
    expect(store.patches.some((p) => p.backfill_page_token)).toBe(false);
    expect(store.patches.at(-1)?.last_error).toContain("bad");
  });
});

describe("incremental", () => {
  const ready = (over: Partial<SyncAccount> = {}) => account({ backfill_done: true, history_id: "100", ...over });

  it("lê o histórico desde o history_id e só avança ao fim do lote", async () => {
    gmail.add({ id: "n1", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.history = [{ ids: ["n1"] }, { ids: ["n1"] }]; // repetida entre páginas
    const r = await run(ready());
    expect(gmail.calls.history).toEqual(["100", "100"]);
    expect(r).toMatchObject({ processed: 1, stored: 1, phase: "incremental", complete: true });
    expect(store.patches).toContainEqual({ history_id: "200" });
  });

  it("erro numa mensagem: history_id não avança", async () => {
    gmail.add({ id: "bad", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.failIds.add("bad");
    gmail.history = [{ ids: ["bad"] }];
    const r = await run(ready());
    expect(r).toMatchObject({ errors: 1, complete: false });
    expect(store.patches.some((p) => p.history_id)).toBe(false);
  });

  it("orçamento esgotado: não avança o history_id", async () => {
    gmail.add({ id: "n1", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.history = [{ ids: ["n1"] }];
    const r = await run(ready(), { deadline: NOW.getTime() });
    expect(r.complete).toBe(false);
    expect(store.patches.some((p) => p.history_id)).toBe(false);
  });

  it("conversa já salva: grava mesmo sem vínculo na mensagem", async () => {
    gmail.add({ id: "m1", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.add({ id: "m2", threadId: "t1", from: "ana@oxyn.com", to: "outro@semvinculo.com" });
    gmail.pages = [{ ids: ["m1"] }];
    await run(account());
    gmail.history = [{ ids: ["m2"] }];
    const r = await run(ready());
    expect(r.stored).toBe(1);
    expect(store.messages.get("m2")?.direction).toBe("out");
    expect([...store.threads.keys()]).toEqual(["t1"]);
  });

  it("histórico expirado: novo history_id e releitura dos últimos 7 dias", async () => {
    gmail.historyError = new GmailHistoryExpiredError();
    gmail.profileHistoryId = "999";
    gmail.add({ id: "r1", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.pages = [{ ids: ["r1"] }];
    const r = await run(ready());
    expect(store.patches[0]).toEqual({ history_id: "999", backfill_done: false, backfill_page_token: encodeCursor("2026/10/28", null) });
    expect(gmail.calls.list[0].q).toBe("after:2026/10/28 -in:chats -in:spam -in:trash");
    expect(r).toMatchObject({ phase: "recovery", stored: 1, complete: true });
    expect(store.patches).toContainEqual(expect.objectContaining({ backfill_done: true, backfill_page_token: null }));
  });
});

describe("idempotência e vínculo desfeito (Review Focus 3)", () => {
  it("sincronizar duas vezes a mesma mensagem não duplica conversa, mensagem nem vínculo", async () => {
    gmail.add({ id: "m1", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.pages = [{ ids: ["m1"] }];
    await run(account());
    const snapshot = JSON.stringify([...store.links]);

    // segunda passada completa (ex.: carga refeita após erro): nada é regravado
    await run(account());
    expect(store.storeCalls).toBe(1);
    expect(store.threads.size).toBe(1);
    expect(store.messages.size).toBe(1);
    expect(JSON.stringify([...store.links])).toBe(snapshot);
  });

  it("mesmo que a mensagem chegue de novo ao armazenamento, o vínculo desfeito não volta", async () => {
    gmail.add({ id: "m1", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.pages = [{ ids: ["m1"] }];
    await run(account());
    const k = [...store.links.keys()][0];
    store.links.set(k, { origin: "auto", unlinked_at: "2026-11-01T00:00:00Z" });

    // nova mensagem da mesma conversa casa de novo com os mesmos cards
    gmail.add({ id: "m2", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.history = [{ ids: ["m2"] }];
    const r = await run(account({ backfill_done: true, history_id: "100" }));
    expect(r.stored).toBe(1);
    expect(r.linked).toBe(0);
    expect(store.links.get(k)?.unlinked_at).toBe("2026-11-01T00:00:00Z");
    expect(store.links.size).toBe(3);
  });
});

describe("erros fatais (Review Focus 5)", () => {
  it("auth e limite de uso sobem para quem chama, sem marcar como concluída", async () => {
    gmail.add({ id: "m1", threadId: "t1", from: "maria@acme.com", to: "ana@oxyn.com" });
    gmail.pages = [{ ids: ["m1"] }];
    gmail.fatalOn = new GmailAuthError();
    await expect(run(account())).rejects.toBeInstanceOf(GmailAuthError);
    gmail.fatalOn = new GmailRateLimitError();
    await expect(run(account())).rejects.toBeInstanceOf(GmailRateLimitError);
    expect(store.patches.some((p) => p.backfill_done)).toBe(false);
    expect(store.storeCalls).toBe(0);
  });
});
