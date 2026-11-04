import { describe, expect, it } from "vitest";
import type { GmailMessage } from "./parse";
import { parseGmailMessage } from "./parse";
import {
  cleanPageToken,
  decodeSnippet,
  cleanQuery,
  effectiveQuery,
  externalSenders,
  mailboxHref,
  mapLimit,
  suggestedPersonName,
  summarizeThread,
  toMessageView,
  visibleMessages,
} from "./live-thread";

const OWN = "eu@oxyn.com.br";

function meta(id: string, o: { from: string; subject: string; at: number; snippet?: string; labels?: string[]; to?: string }): GmailMessage {
  return {
    id,
    threadId: "t1",
    internalDate: String(o.at),
    snippet: o.snippet ?? "",
    labelIds: o.labels ?? ["INBOX"],
    payload: {
      headers: [
        { name: "From", value: o.from },
        { name: "To", value: o.to ?? OWN },
        { name: "Subject", value: o.subject },
      ],
    },
  };
}

describe("summarizeThread", () => {
  it("usa o assunto original, a última mensagem e a contagem", () => {
    const s = summarizeThread(
      "t1",
      {
        id: "t1",
        messages: [
          meta("a", { from: "Ana <ana@cliente.com>", subject: "Proposta", at: 1_700_000_000_000, snippet: "primeira" }),
          meta("b", { from: `Eu <${OWN}>`, subject: "Re: Proposta", at: 1_700_000_100_000, snippet: "segunda" }),
          meta("c", { from: "Ana <ana@cliente.com>", subject: "Re: Proposta", at: 1_700_000_200_000, snippet: "terceira" }),
        ],
      },
      OWN,
    );
    expect(s).toMatchObject({ gmailThreadId: "t1", subject: "Proposta", sender: "Ana", snippet: "terceira", messageCount: 3 });
    expect(s.lastAt).toBe(new Date(1_700_000_200_000).toISOString());
  });

  it("mostra Você quando a última mensagem é da própria caixa, sem diferenciar maiúsculas", () => {
    const s = summarizeThread(
      "t1",
      { id: "t1", messages: [meta("a", { from: "EU@Oxyn.com.br", subject: "Oi", at: 1_700_000_000_000 })] },
      OWN,
    );
    expect(s.sender).toBe("Você");
  });

  it("usa o e-mail quando o remetente não tem nome", () => {
    const s = summarizeThread("t1", { id: "t1", messages: [meta("a", { from: "x@y.com", subject: "S", at: 1_700_000_000_000 })] }, OWN);
    expect(s.sender).toBe("x@y.com");
  });

  it("ignora rascunho, spam e lixo", () => {
    const s = summarizeThread(
      "t1",
      {
        id: "t1",
        messages: [
          meta("a", { from: "x@y.com", subject: "Real", at: 1_700_000_000_000 }),
          meta("b", { from: `Eu <${OWN}>`, subject: "Real", at: 1_700_000_100_000, labels: ["DRAFT"] }),
        ],
      },
      OWN,
    );
    expect(s.messageCount).toBe(1);
    expect(s.sender).toBe("x@y.com");
  });

  it("sem mensagens legíveis cai no trecho da listagem", () => {
    expect(summarizeThread("t9", null, OWN, "trecho")).toEqual({
      gmailThreadId: "t9",
      subject: "",
      sender: "",
      lastAt: null,
      snippet: "trecho",
      messageCount: 0,
    });
  });
});

describe("decodeSnippet", () => {
  it("decodifica as entidades do trecho do Gmail", () => {
    expect(decodeSnippet("Voc&#39;e &amp; eu &quot;ok&quot; &lt;a&gt;&nbsp;fim &#x41;")).toBe(`Voc'e & eu "ok" <a> fim A`);
  });
});

describe("mapLimit", () => {
  it("respeita o limite e preserva a ordem", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 * ((n % 3) + 1)));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(peak).toBe(3);
  });

  it("lista vazia", async () => {
    expect(await mapLimit([], 5, async (n: number) => n)).toEqual([]);
  });
});

describe("paginação e busca", () => {
  it("mailboxHref omite o que está vazio e codifica a busca", () => {
    expect(mailboxHref("/oxyn/email", {})).toBe("/oxyn/email");
    expect(mailboxHref("/oxyn/email", { caixa: "c1", q: "  from:ana  ", pagina: null })).toBe("/oxyn/email?caixa=c1&q=from%3Aana");
    expect(mailboxHref("/oxyn/email", { caixa: "c1", pagina: "tok_1" })).toBe("/oxyn/email?caixa=c1&pagina=tok_1");
  });

  it("cleanPageToken aceita só tokens plausíveis", () => {
    expect(cleanPageToken("0123abc-_")).toBe("0123abc-_");
    expect(cleanPageToken(undefined)).toBeNull();
    expect(cleanPageToken("")).toBeNull();
    expect(cleanPageToken("a b&c=d")).toBeNull();
  });

  it("cleanQuery apara e limita", () => {
    expect(cleanQuery("  is:unread ")).toBe("is:unread");
    expect(cleanQuery(undefined)).toBe("");
    expect(cleanQuery("x".repeat(500))).toHaveLength(200);
  });

  it("effectiveQuery exclui chats, spam e lixo quando não há busca", () => {
    expect(effectiveQuery("")).toBe("-in:chats -in:spam -in:trash");
    expect(effectiveQuery("from:ana")).toBe("from:ana");
  });
});

describe("conversa ao vivo", () => {
  const full = (id: string, from: string, at: number, labels?: string[]) => meta(id, { from, subject: "S", at, labels });

  it("visibleMessages tira rascunho e ordena por data", () => {
    const list = visibleMessages([full("b", "x@y.com", 2000), full("a", "x@y.com", 1000), full("d", "x@y.com", 3000, ["DRAFT"])]);
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("toMessageView dá a direção pela caixa", () => {
    const v = toMessageView(parseGmailMessage(full("a", `"Souza, Ana" <ANA@Cliente.com>`, 1_700_000_000_000)), OWN);
    expect(v).toMatchObject({ fromEmail: "ana@cliente.com", fromName: "Souza, Ana", direction: "in" });
    const out = toMessageView(parseGmailMessage(full("b", `Eu <${OWN}>`, 1_700_000_000_000)), OWN);
    expect(out.direction).toBe("out");
  });

  it("externalSenders: distintos, sem a própria caixa, guardando o primeiro nome visto", () => {
    const views = [
      full("1", "ana@cliente.com", 1000),
      full("2", `Eu <${OWN}>`, 2000),
      full("3", "Ana Souza <ANA@cliente.com>", 3000),
      full("4", "Bia <bia@outra.com>", 4000),
    ].map((m) => toMessageView(parseGmailMessage(m), OWN));
    expect(externalSenders(views, OWN)).toEqual([
      { email: "ana@cliente.com", name: "Ana Souza" },
      { email: "bia@outra.com", name: "Bia" },
    ]);
  });

  it("suggestedPersonName usa o nome ou deriva do e-mail", () => {
    expect(suggestedPersonName({ email: "a@b.com", name: "Ana Souza" })).toBe("Ana Souza");
    expect(suggestedPersonName({ email: "joao.silva@b.com", name: null })).toBe("Joao Silva");
  });
});
