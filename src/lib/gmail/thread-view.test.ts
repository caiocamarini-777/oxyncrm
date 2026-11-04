import { describe, expect, it } from "vitest";
import {
  buildEmailSrcdoc,
  buildRecordThreads,
  clampIframeHeight,
  EMAIL_CSP,
  threadParticipants,
  type MessageRow,
} from "./thread-view";

const msg = (over: Partial<MessageRow>): MessageRow => ({
  id: "m",
  thread_id: "t1",
  gmail_message_id: "g",
  from_email: "ana@cliente.com",
  from_name: null,
  to: [],
  cc: [],
  sent_at: "2026-01-01T10:00:00Z",
  snippet: "",
  body_html: null,
  body_text: null,
  attachments: [],
  direction: "in",
  ...over,
});

describe("buildRecordThreads", () => {
  const base = {
    links: [
      { id: "l1", thread_id: "t1" },
      { id: "l2", thread_id: "t2" },
    ],
    threads: [
      { id: "t1", account_id: "a1", subject: "Antiga", last_message_at: "2026-01-02T00:00:00Z" },
      { id: "t2", account_id: "a2", subject: "Nova", last_message_at: "2026-03-01T00:00:00Z" },
    ],
    messages: [
      msg({ id: "m2", thread_id: "t1", sent_at: "2026-01-02T00:00:00Z" }),
      msg({ id: "m1", thread_id: "t1", sent_at: "2026-01-01T00:00:00Z" }),
      msg({ id: "m3", thread_id: "t2", direction: "out", from_email: "vendas@oxyn.com", sent_at: "2026-03-01T00:00:00Z" }),
    ],
    mineAccounts: new Map([["a1", "eu@oxyn.com"]]),
    canEditRecord: false,
  };

  it("conversa mais recente primeiro e mensagens em ordem cronológica", () => {
    const out = buildRecordThreads(base);
    expect(out.map((t) => t.threadId)).toEqual(["t2", "t1"]);
    expect(out[1].messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("caixa própria: e-mail da caixa, isMine e pode desvincular", () => {
    const t1 = buildRecordThreads(base).find((t) => t.threadId === "t1")!;
    expect(t1).toMatchObject({ isMine: true, canUnlink: true, accountEmail: "eu@oxyn.com", linkId: "l1" });
  });

  it("caixa de outro usuário: e-mail vem da mensagem enviada e só desvincula quem edita o registro", () => {
    const t2 = buildRecordThreads(base).find((t) => t.threadId === "t2")!;
    expect(t2).toMatchObject({ isMine: false, canUnlink: false, accountEmail: "vendas@oxyn.com" });
    const edit = buildRecordThreads({ ...base, canEditRecord: true }).find((t) => t.threadId === "t2")!;
    expect(edit.canUnlink).toBe(true);
  });

  it("sem mensagem enviada e caixa alheia: accountEmail nulo; thread sem vínculo ativo é ignorada", () => {
    const out = buildRecordThreads({
      ...base,
      links: [{ id: "l1", thread_id: "t1" }],
      mineAccounts: new Map(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].accountEmail).toBeNull();
  });

  it("normaliza endereços e anexos vindos do jsonb", () => {
    const [t] = buildRecordThreads({
      ...base,
      links: [{ id: "l1", thread_id: "t1" }],
      threads: [base.threads[0]],
      messages: [
        msg({
          to: [{ email: "b@x.com", name: "Bia" }, { email: "c@x.com" }, "lixo"],
          attachments: [{ filename: "proposta.pdf", size: 1 }, { size: 2 }],
        }),
      ],
    });
    expect(t.messages[0].to).toEqual([
      { email: "b@x.com", name: "Bia" },
      { email: "c@x.com", name: null },
    ]);
    expect(t.messages[0].attachments).toEqual([{ filename: "proposta.pdf" }, { filename: "(sem nome)" }]);
  });
});

describe("threadParticipants", () => {
  it("nomes distintos, com resumo", () => {
    const t = buildRecordThreads({
      links: [{ id: "l", thread_id: "t1" }],
      threads: [{ id: "t1", account_id: "a", subject: "x", last_message_at: null }],
      messages: [
        msg({ from_name: "Ana", to: [{ email: "b@x.com", name: "Bia" }, { email: "c@x.com", name: null }, { email: "d@x.com", name: "Dan" }] }),
        msg({ id: "m2", from_email: "ANA@cliente.com", from_name: "Ana" }),
      ],
      mineAccounts: new Map(),
      canEditRecord: false,
    })[0];
    expect(threadParticipants(t.messages)).toBe("Ana, Bia, c@x.com e mais 1");
    expect(threadParticipants(t.messages, 10)).toBe("Ana, Bia, c@x.com, Dan");
  });
});

describe("buildEmailSrcdoc", () => {
  it("inclui a CSP, o base target e o conteúdo", () => {
    const doc = buildEmailSrcdoc("<p>Oi</p>");
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${EMAIL_CSP}">`);
    expect(doc).toContain(`<base target="_blank">`);
    expect(doc).toContain("<p>Oi</p>");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<p>Oi</p>"));
  });
  it("CSP bloqueia scripts e carregamento fora de https/data", () => {
    expect(EMAIL_CSP).toBe("default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:");
  });
  it("remove meta refresh do e-mail", () => {
    const doc = buildEmailSrcdoc(`<meta http-equiv="refresh" content="0;url=https://evil.com"><p>x</p>`);
    expect(doc).not.toMatch(/refresh/i);
    expect(doc).toContain("<p>x</p>");
  });
});

describe("clampIframeHeight", () => {
  it("limita entre o mínimo e 800", () => {
    expect(clampIframeHeight(0)).toBe(40);
    expect(clampIframeHeight(300.2)).toBe(301);
    expect(clampIframeHeight(5000)).toBe(800);
    expect(clampIframeHeight(NaN)).toBe(40);
  });
});
