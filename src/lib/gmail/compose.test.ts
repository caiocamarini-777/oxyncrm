import { describe, expect, it } from "vitest";
import {
  bodyToHtml,
  buildTemplateVars,
  escapeHtml,
  firstPersonEmail,
  headerOf,
  parseEmailList,
  replyHeaders,
  replyRecipients,
  replySubject,
  sendEmailSchema,
} from "./compose";
import { renderTemplate } from "./template";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

describe("bodyToHtml", () => {
  it("escapa o texto e troca quebras de linha por <br>", () => {
    const html = bodyToHtml("Olá <b>&\"x\"</b>\r\nlinha 2\n\nlinha 4");
    expect(html).toContain("Olá &lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;<br>linha 2<br><br>linha 4");
    expect(html).not.toContain("<b>");
  });
  it("fica numa div com fonte sans-serif", () => {
    expect(bodyToHtml("oi")).toMatch(/^<div style="font-family: Arial, Helvetica, sans-serif;[^"]*">oi<\/div>$/);
  });
  it("escapeHtml cobre aspas simples", () => {
    expect(escapeHtml(`it's`)).toBe("it&#39;s");
  });
});

describe("replySubject", () => {
  it("põe Re: quando falta", () => {
    expect(replySubject("Proposta")).toBe("Re: Proposta");
  });
  it("não repete Re:/RE:/Res:", () => {
    expect(replySubject("Re: Proposta")).toBe("Re: Proposta");
    expect(replySubject("RE:Proposta")).toBe("RE:Proposta");
    expect(replySubject("Res: Proposta")).toBe("Res: Proposta");
  });
  it("aparar espaços", () => {
    expect(replySubject("  Proposta ")).toBe("Re: Proposta");
  });
});

describe("replyHeaders", () => {
  it("References da original mais o Message-ID, e In-Reply-To", () => {
    expect(replyHeaders({ messageId: "<c@x>", references: "<a@x> <b@x>" })).toEqual({
      inReplyTo: "<c@x>",
      references: "<a@x> <b@x> <c@x>",
    });
  });
  it("sem References usa só o Message-ID", () => {
    expect(replyHeaders({ messageId: "<a@x>", references: "" })).toEqual({ inReplyTo: "<a@x>", references: "<a@x>" });
  });
  it("não repete o Message-ID que já está nas References", () => {
    expect(replyHeaders({ messageId: "<b@x>", references: "<a@x>\r\n <b@x>" }).references).toBe("<a@x> <b@x>");
  });
  it("sem Message-ID não monta cabeçalhos", () => {
    expect(replyHeaders({ messageId: " ", references: "<a@x>" })).toEqual({});
  });
});

describe("headerOf", () => {
  it("lê o cabeçalho sem diferenciar maiúsculas", () => {
    const msg = { id: "m", threadId: "t", payload: { headers: [{ name: "message-id", value: " <a@x> " }] } };
    expect(headerOf(msg, "Message-ID")).toBe("<a@x>");
    expect(headerOf(msg, "References")).toBe("");
  });
});

describe("buildTemplateVars", () => {
  it("monta as cinco variáveis", () => {
    expect(
      buildTemplateVars({ personName: "Ana Maria Souza", organizationName: "Acme", dealTitle: "Contrato", userName: "Caio" }),
    ).toEqual({
      "pessoa.nome": "Ana Maria Souza",
      "pessoa.primeiro_nome": "Ana",
      "organizacao.nome": "Acme",
      "negocio.titulo": "Contrato",
      "usuario.nome": "Caio",
    });
  });
  it("o que falta fica vazio e o modelo renderiza sem sobras", () => {
    const vars = buildTemplateVars({ userName: "Caio" });
    expect(vars["pessoa.primeiro_nome"]).toBe("");
    expect(renderTemplate("Oi {{pessoa.primeiro_nome}}, {{ usuario.nome }} aqui. {{negocio.titulo}}", vars)).toBe("Oi , Caio aqui. ");
  });
});

describe("parseEmailList", () => {
  it("separa por vírgula, ponto e vírgula e espaço, sem vazios nem repetidos", () => {
    expect(parseEmailList(" a@b.com, c@d.com;A@B.com  e@f.com,, ")).toEqual(["a@b.com", "c@d.com", "e@f.com"]);
    expect(parseEmailList("")).toEqual([]);
  });
});

describe("firstPersonEmail", () => {
  it("pega o primeiro e-mail válido", () => {
    expect(firstPersonEmail([{ value: "x" }, { label: "Trabalho", value: " ana@acme.com " }, { value: "b@c.com" }])).toBe("ana@acme.com");
    expect(firstPersonEmail([])).toBeNull();
    expect(firstPersonEmail(null)).toBeNull();
  });
});

describe("replyRecipients", () => {
  const m = (direction: "in" | "out", fromEmail: string, to: string[] = []) => ({
    direction,
    fromEmail,
    to: to.map((email) => ({ email })),
  });
  it("responde ao remetente da última mensagem recebida", () => {
    expect(replyRecipients([m("in", "ana@x.com"), m("out", "eu@o.com", ["ana@x.com"]), m("in", "bia@x.com"), m("out", "eu@o.com", ["bia@x.com"])])).toEqual([
      "bia@x.com",
    ]);
  });
  it("sem recebidas, usa o primeiro destinatário da última enviada", () => {
    expect(replyRecipients([m("out", "eu@o.com", ["cli@x.com", "z@x.com"])])).toEqual(["cli@x.com"]);
    expect(replyRecipients([])).toEqual([]);
  });
});

describe("sendEmailSchema", () => {
  const ok = { accountId: ACCOUNT, to: ["ana@acme.com"], subject: "Oi", body: "Texto" };
  it("aceita o mínimo e assume cc vazio", () => {
    const r = sendEmailSchema.safeParse(ok);
    expect(r.success && r.data.cc).toEqual([]);
  });
  it("exige ao menos um destinatário e e-mails válidos", () => {
    expect(sendEmailSchema.safeParse({ ...ok, to: [] }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...ok, to: ["sem-arroba"] }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...ok, to: ["a@b.com\r\nBcc: x@y.com"] }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...ok, cc: ["<x>@y.com"] }).success).toBe(false);
  });
  it("limita assunto a 998 caracteres e corpo a 100 KB", () => {
    expect(sendEmailSchema.safeParse({ ...ok, subject: "a".repeat(998) }).success).toBe(true);
    expect(sendEmailSchema.safeParse({ ...ok, subject: "a".repeat(999) }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...ok, body: "a".repeat(100 * 1024) }).success).toBe(true);
    expect(sendEmailSchema.safeParse({ ...ok, body: "a".repeat(100 * 1024 + 1) }).success).toBe(false);
    // 100 KB contados em bytes, não em caracteres
    expect(sendEmailSchema.safeParse({ ...ok, body: "é".repeat(51 * 1024) }).success).toBe(false);
  });
  it("rejeita corpo vazio e ids inválidos", () => {
    expect(sendEmailSchema.safeParse({ ...ok, body: "" }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...ok, accountId: "x" }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...ok, gmailThreadId: "a b" }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...ok, record: { entity: "users", id: ACCOUNT } }).success).toBe(false);
    expect(sendEmailSchema.safeParse({ ...ok, record: { entity: "deals", id: ACCOUNT }, gmailThreadId: "abc123" }).success).toBe(true);
  });
});
