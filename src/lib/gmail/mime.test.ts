import { describe, expect, it } from "vitest";
import { buildMime, toBase64Url } from "./mime";

const base = {
  from: "ana@oxyn.com",
  to: ["maria@acme.com", "joao@acme.com"],
  subject: "Proposta",
  text: "Olá, tudo bem?",
  html: "<p>Olá, tudo bem?</p>",
};

/** Lê o corpo de uma parte base64 do MIME. */
function partBody(mime: string, type: string): string {
  const i = mime.indexOf(`Content-Type: ${type}`);
  const after = mime.slice(i).split("\r\n\r\n")[1].split("\r\n--")[0];
  return Buffer.from(after.replace(/\r\n/g, ""), "base64").toString("utf8");
}

describe("buildMime", () => {
  it("usa CRLF, MIME-Version e multipart/alternative", () => {
    const m = buildMime(base);
    expect(m).toContain("MIME-Version: 1.0\r\n");
    expect(m).toMatch(/Content-Type: multipart\/alternative; boundary="[^"]+"/);
    expect(m).not.toMatch(/[^\r]\n/);
    expect(m).toContain("From: ana@oxyn.com\r\n");
    expect(m).toContain("To: maria@acme.com, joao@acme.com\r\n");
    expect(m).not.toContain("Cc:");
    expect(m).toContain("Subject: Proposta\r\n");
  });

  it("fecha o boundary e carrega texto e HTML em UTF-8", () => {
    const m = buildMime(base);
    const boundary = /boundary="([^"]+)"/.exec(m)![1];
    expect(m).toContain(`--${boundary}--`);
    expect(partBody(m, "text/plain")).toBe("Olá, tudo bem?");
    expect(partBody(m, "text/html")).toBe("<p>Olá, tudo bem?</p>");
  });

  it("assunto não-ASCII vira RFC 2047", () => {
    const m = buildMime({ ...base, subject: "Proposta – reunião" });
    const line = /Subject: (.*)\r\n/.exec(m)![1];
    expect(line.startsWith("=?UTF-8?B?")).toBe(true);
    const decoded = [...line.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]
      .map((x) => Buffer.from(x[1], "base64").toString("utf8"))
      .join("");
    expect(decoded).toBe("Proposta – reunião");
  });

  it("assunto longo é dividido em palavras de até 75 caracteres", () => {
    const m = buildMime({ ...base, subject: "ç".repeat(200) });
    const words = m.match(/=\?UTF-8\?B\?[^?]+\?=/g)!;
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
  });

  it("inclui Cc, In-Reply-To e References quando vêm", () => {
    const m = buildMime({ ...base, cc: ["c@x.com", "d@x.com"], inReplyTo: "<a@b>", references: "<z@y> <a@b>" });
    expect(m).toContain("Cc: c@x.com, d@x.com\r\n");
    expect(m).toContain("In-Reply-To: <a@b>\r\n");
    expect(m).toContain("References: <z@y> <a@b>\r\n");
  });

  it("codifica o nome acentuado do remetente", () => {
    const m = buildMime({ ...base, from: "João Silva <joao@oxyn.com>" });
    const line = /From: (.*)\r\n/.exec(m)![1];
    expect(line).toMatch(/^=\?UTF-8\?B\?.+\?= <joao@oxyn.com>$/);
  });

  it("quebra de linha no assunto não injeta cabeçalho", () => {
    const m = buildMime({ ...base, subject: "Oi\r\nBcc: espiao@x.com" });
    expect(m).not.toMatch(/\r\nBcc:/);
  });
});

describe("toBase64Url", () => {
  it("usa o alfabeto url-safe, sem padding, em UTF-8", () => {
    expect(toBase64Url("??>>")).toBe("Pz8-Pg");
    expect(Buffer.from(toBase64Url("ação"), "base64url").toString("utf8")).toBe("ação");
  });
});
