import { describe, expect, it } from "vitest";
import {
  type GmailMessage,
  type GmailMessagePart,
  MAX_HTML_BYTES,
  MAX_TEXT_BYTES,
  parseGmailMessage,
  truncateUtf8,
} from "./parse";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const h = (name: string, value: string) => ({ name, value });
const leaf = (mimeType: string, content: string, extra: Partial<GmailMessagePart> = {}): GmailMessagePart => ({
  mimeType,
  body: { data: b64(content), size: content.length },
  ...extra,
});

function msg(payload: GmailMessagePart, extra: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: "m1",
    threadId: "t1",
    historyId: "999",
    internalDate: "1730678400000",
    snippet: "oi",
    payload,
    ...extra,
  };
}

const headers = [
  h("From", '"Silva, Maria" <Maria@Empresa.com>'),
  h("To", "ana@oxyn.com, Bia <bia@oxyn.com>"),
  h("Cc", "cc@x.com"),
  h("Subject", "=?UTF-8?B?UHJvcG9zdGEg4oCTIGHDp8Ojbw==?="),
  h("Message-ID", "<abc@mail.gmail.com>"),
];

describe("parseGmailMessage", () => {
  it("lê cabeçalhos, data e identificadores", () => {
    const p = parseGmailMessage(msg({ mimeType: "text/plain", headers, body: { data: b64("Olá"), size: 3 } }));
    expect(p.gmailId).toBe("m1");
    expect(p.threadId).toBe("t1");
    expect(p.historyId).toBe("999");
    expect(p.rfcMessageId).toBe("<abc@mail.gmail.com>");
    expect(p.subject).toBe("Proposta – ação");
    expect(p.from).toEqual({ email: "maria@empresa.com", name: "Silva, Maria" });
    expect(p.to.map((a) => a.email)).toEqual(["ana@oxyn.com", "bia@oxyn.com"]);
    expect(p.cc.map((a) => a.email)).toEqual(["cc@x.com"]);
    expect(p.sentAt).toBe(new Date(1730678400000).toISOString());
    expect(p.snippet).toBe("oi");
  });

  it("acha cabeçalhos sem diferenciar maiúsculas", () => {
    const p = parseGmailMessage(
      msg({ mimeType: "text/plain", headers: [h("FROM", "a@b.com"), h("message-id", "<x>")], body: { data: b64("x") } }),
    );
    expect(p.from.email).toBe("a@b.com");
    expect(p.rfcMessageId).toBe("<x>");
  });

  it("Review Focus 1: só text/plain devolve o texto e html null", () => {
    const p = parseGmailMessage(msg({ mimeType: "text/plain", headers, body: { data: b64("Só texto ção"), size: 12 } }));
    expect(p.text).toBe("Só texto ção");
    expect(p.html).toBeNull();
  });

  it("Review Focus 1: multipart/alternative com related aninhado traz texto e html", () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/alternative",
      headers,
      body: { size: 0 },
      parts: [
        leaf("text/plain", "Texto puro"),
        {
          mimeType: "multipart/related",
          body: { size: 0 },
          parts: [
            leaf("text/html", "<p>Olá <b>mundo</b></p>"),
            {
              mimeType: "image/png",
              filename: "",
              headers: [h("Content-ID", "<logo>")],
              body: { attachmentId: "img1", size: 10 },
            },
          ],
        },
      ],
    };
    const p = parseGmailMessage(msg(payload));
    expect(p.text).toBe("Texto puro");
    expect(p.html).toBe("<p>Olá <b>mundo</b></p>");
    expect(p.attachments).toEqual([]);
  });

  it("html dentro de multipart/related sem text/plain", () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/related",
      headers,
      parts: [leaf("text/html", "<i>oi</i>")],
    };
    const p = parseGmailMessage(msg(payload));
    expect(p.html).toBe("<i>oi</i>");
    expect(p.text).toBeNull();
  });

  it("anexos são as partes com filename não vazio", () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/mixed",
      headers,
      parts: [
        leaf("text/plain", "corpo"),
        { mimeType: "application/pdf", filename: "proposta.pdf", body: { attachmentId: "att1", size: 2048 } },
        { mimeType: "image/png", filename: "", body: { attachmentId: "inline", size: 5 } },
      ],
    };
    const p = parseGmailMessage(msg(payload));
    expect(p.text).toBe("corpo");
    expect(p.attachments).toEqual([
      { filename: "proposta.pdf", mimeType: "application/pdf", size: 2048, attachmentId: "att1" },
    ]);
  });

  it("anexo de texto não vira corpo", () => {
    const payload: GmailMessagePart = {
      mimeType: "multipart/mixed",
      headers,
      parts: [leaf("text/plain", "corpo"), leaf("text/plain", "conteúdo do anexo", { filename: "nota.txt" })],
    };
    const p = parseGmailMessage(msg(payload));
    expect(p.text).toBe("corpo");
    expect(p.attachments).toHaveLength(1);
  });

  it("HTML acima de 512 KB vira null e o texto fica", () => {
    const big = "<p>" + "a".repeat(MAX_HTML_BYTES) + "</p>";
    const payload: GmailMessagePart = {
      mimeType: "multipart/alternative",
      headers,
      parts: [leaf("text/plain", "resumo"), leaf("text/html", big)],
    };
    const p = parseGmailMessage(msg(payload));
    expect(p.html).toBeNull();
    expect(p.text).toBe("resumo");
  });

  it("texto acima de 512 KB é cortado no limite, sem partir caractere", () => {
    const payload: GmailMessagePart = { mimeType: "text/plain", headers, ...leaf("text/plain", "é".repeat(MAX_TEXT_BYTES)) };
    const p = parseGmailMessage(msg(payload));
    expect(Buffer.byteLength(p.text!, "utf8")).toBe(MAX_TEXT_BYTES);
    expect(p.text!.endsWith("é")).toBe(true);
    expect(truncateUtf8("aé", 2)).toBe("a");
    expect(truncateUtf8("abc", 5)).toBe("abc");
  });

  it("respeita o charset da parte", () => {
    const latin = Buffer.from("ação", "latin1").toString("base64url");
    const p = parseGmailMessage(
      msg({
        mimeType: "text/plain",
        headers: [...headers, h("Content-Type", 'text/plain; charset="ISO-8859-1"')],
        body: { data: latin },
      }),
    );
    expect(p.text).toBe("ação");
  });

  it("mensagem sem payload ou sem cabeçalhos não quebra", () => {
    const p = parseGmailMessage({ id: "x", threadId: "y" });
    expect(p.from).toEqual({ email: "", name: null });
    expect(p.subject).toBe("");
    expect(p.to).toEqual([]);
    expect(p.html).toBeNull();
    expect(p.text).toBeNull();
    expect(p.rfcMessageId).toBeNull();
    expect(p.historyId).toBeNull();
  });
});
