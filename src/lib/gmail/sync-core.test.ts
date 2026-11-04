import { describe, expect, it } from "vitest";
import {
  backfillAfter,
  backfillQuery,
  buildMessageRow,
  chunk,
  clean,
  decodeCursor,
  dedupeRefs,
  directionOf,
  encodeCursor,
  groupByThread,
  messageAddresses,
  needsFull,
  recoveryAfter,
  skipByLabels,
  threadPatch,
} from "./sync-core";
import type { ParsedMessage } from "./parse";

const parsed = (over: Partial<ParsedMessage> = {}): ParsedMessage => ({
  gmailId: "m1",
  threadId: "t1",
  rfcMessageId: "<a@b>",
  subject: "Proposta",
  from: { email: "Maria@Acme.com", name: "Maria" },
  to: [{ email: "ana@oxyn.com", name: null }],
  cc: [{ email: "x@acme.com", name: "X" }],
  sentAt: "2026-05-01T10:00:00.000Z",
  snippet: "oi",
  html: "<p>oi</p>",
  text: "oi",
  attachments: [{ filename: "a.pdf", mimeType: "application/pdf", size: 10, attachmentId: "att" }],
  historyId: "5",
  ...over,
});

describe("janelas da carga", () => {
  const now = new Date("2026-11-04T15:00:00Z");
  it("12 meses para a primeira carga e 7 dias para a recuperação", () => {
    expect(backfillAfter(now)).toBe("2025/11/04");
    expect(recoveryAfter(now)).toBe("2026/10/28");
  });
  it("consulta exclui chats, spam e lixo", () => {
    expect(backfillQuery("2025/11/04")).toBe("after:2025/11/04 -in:chats -in:spam -in:trash");
  });
  it("cursor: ida e volta, e nulo/sem prefixo significa 12 meses", () => {
    expect(decodeCursor(encodeCursor("2026/10/28", "tok"), now)).toEqual({ after: "2026/10/28", pageToken: "tok" });
    expect(decodeCursor(encodeCursor("2026/10/28", null), now)).toEqual({ after: "2026/10/28", pageToken: null });
    expect(decodeCursor(null, now)).toEqual({ after: "2025/11/04", pageToken: null });
    expect(decodeCursor("abc123", now)).toEqual({ after: "2025/11/04", pageToken: "abc123" });
  });
});

describe("decisões", () => {
  it("full só com vínculo ou conversa já salva", () => {
    expect(needsFull([], false)).toBe(false);
    expect(needsFull([{ entity: "persons", recordId: "p" }], false)).toBe(true);
    expect(needsFull([], true)).toBe(true);
  });
  it("ignora spam, lixo, rascunho e chat", () => {
    expect(skipByLabels(["INBOX", "UNREAD"])).toBe(false);
    expect(skipByLabels(undefined)).toBe(false);
    for (const l of ["SPAM", "TRASH", "DRAFT", "CHAT"]) expect(skipByLabels(["INBOX", l])).toBe(true);
  });
  it("endereços minúsculos e sem vazios", () => {
    expect(messageAddresses(parsed())).toEqual(["maria@acme.com", "ana@oxyn.com", "x@acme.com"]);
    expect(messageAddresses(parsed({ from: { email: "", name: null }, to: [], cc: [] }))).toEqual([]);
  });
  it("direção: out só quando o remetente é a caixa", () => {
    expect(directionOf("ANA@oxyn.com", "ana@oxyn.com")).toBe("out");
    expect(directionOf("maria@acme.com", "ana@oxyn.com")).toBe("in");
  });
});

describe("linha da mensagem", () => {
  it("monta as colunas da tabela", () => {
    const row = buildMessageRow({ id: "acc", email: "ana@oxyn.com" }, "thr", parsed());
    expect(row).toEqual({
      thread_id: "thr",
      account_id: "acc",
      gmail_message_id: "m1",
      rfc_message_id: "<a@b>",
      from_email: "maria@acme.com",
      from_name: "Maria",
      to: [{ email: "ana@oxyn.com", name: null }],
      cc: [{ email: "x@acme.com", name: "X" }],
      sent_at: "2026-05-01T10:00:00.000Z",
      snippet: "oi",
      body_html: "<p>oi</p>",
      body_text: "oi",
      attachments: [{ filename: "a.pdf", mimeType: "application/pdf", size: 10 }],
      direction: "in",
    });
  });
  it("remetente igual à caixa vira out", () => {
    expect(buildMessageRow({ id: "a", email: "maria@acme.com" }, "t", parsed()).direction).toBe("out");
  });
  it("tira NUL e substitutos soltos, que o Postgres recusa", () => {
    expect(clean("a\u0000b")).toBe("ab");
    expect(clean("x\ud800y")).toBe("x�y");
    expect(clean(null)).toBeNull();
    expect(buildMessageRow({ id: "a", email: "e@e.com" }, "t", parsed({ text: "a\u0000b" })).body_text).toBe("ab");
  });
});

describe("threadPatch", () => {
  it("conversa nova: assunto e data", () => {
    expect(threadPatch(null, parsed())).toEqual({ subject: "Proposta", last_message_at: "2026-05-01T10:00:00.000Z" });
  });
  it("last_message_at é o maior sent_at", () => {
    const ex = { subject: "Proposta", last_message_at: "2026-05-03T00:00:00.000Z" };
    expect(threadPatch(ex, parsed())).toEqual({});
    expect(threadPatch({ ...ex, last_message_at: "2026-04-01T00:00:00.000Z" }, parsed())).toEqual({
      last_message_at: "2026-05-01T10:00:00.000Z",
    });
  });
  it("assunto: troca 'Re:' pelo original, mas não o contrário", () => {
    const ex = { subject: "RES: Proposta", last_message_at: "2026-05-03T00:00:00.000Z" };
    expect(threadPatch(ex, parsed({ subject: "Proposta" })).subject).toBe("Proposta");
    expect(threadPatch({ ...ex, subject: "Proposta" }, parsed({ subject: "Re: Proposta" })).subject).toBeUndefined();
    expect(threadPatch({ ...ex, subject: "" }, parsed({ subject: "Re: Proposta" })).subject).toBe("Re: Proposta");
  });
});

describe("lotes", () => {
  it("chunk, dedupeRefs e groupByThread", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(dedupeRefs([{ id: "a" }, { id: "b" }, { id: "a" }])).toEqual([{ id: "a" }, { id: "b" }]);
    const g = groupByThread([
      { id: "1", threadId: "x" },
      { id: "2", threadId: "y" },
      { id: "3", threadId: "x" },
    ]);
    expect(g.map((x) => x.map((r) => r.id))).toEqual([["1", "3"], ["2"]]);
  });
});
