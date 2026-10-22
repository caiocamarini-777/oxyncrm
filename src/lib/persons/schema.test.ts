import { describe, expect, it } from "vitest";
import { isWhatsappPhone, personSchema, whatsappHref } from "./schema";

const base = { fullName: "Ana Souza" };

describe("personSchema", () => {
  it("aceita só o nome", () => {
    const r = personSchema.parse(base);
    expect(r.emails).toEqual([]);
    expect(r.phones).toEqual([]);
    expect(r.jobTitle).toBeNull();
    expect(r.linkedinUrl).toBeNull();
    expect(r.organizationId).toBeNull();
  });
  it("valida o nome", () => {
    expect(personSchema.safeParse({ fullName: "  " }).success).toBe(false);
    expect(personSchema.safeParse({ fullName: "a".repeat(201) }).success).toBe(false);
  });
  it("rejeita e-mail repetido com caixa diferente", () => {
    const r = personSchema.safeParse({
      ...base,
      emails: [
        { label: "Trabalho", value: "Ana@Volt.com" },
        { label: "Pessoal", value: "ana@volt.com" },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("normaliza e-mail para minúsculas e rejeita inválido", () => {
    const r = personSchema.parse({ ...base, emails: [{ label: "Trabalho", value: " Ana@Volt.COM " }] });
    expect(r.emails).toEqual([{ label: "Trabalho", value: "ana@volt.com" }]);
    expect(personSchema.safeParse({ ...base, emails: [{ label: "Trabalho", value: "ana@" }] }).success).toBe(false);
  });
  it("normaliza telefone para dígitos", () => {
    const r = personSchema.parse({ ...base, phones: [{ label: "Celular", value: "(11) 99999-0000" }] });
    expect(r.phones).toEqual([{ label: "Celular", value: "11999990000" }]);
  });
  it("rejeita telefone fora de 10 a 13 dígitos", () => {
    expect(personSchema.safeParse({ ...base, phones: [{ label: "Outro", value: "123456789" }] }).success).toBe(false);
    expect(personSchema.safeParse({ ...base, phones: [{ label: "Outro", value: "12345678901234" }] }).success).toBe(false);
    expect(personSchema.safeParse({ ...base, phones: [{ label: "Outro", value: "+55 11 99999-0000" }] }).success).toBe(true);
  });
  it("+55 e forma nacional são o mesmo telefone", () => {
    const r = personSchema.parse({ ...base, phones: [{ label: "Celular", value: "+55 11 99999-0000" }] });
    expect(r.phones).toEqual([{ label: "Celular", value: "11999990000" }]);
    const dup = personSchema.safeParse({
      ...base,
      phones: [
        { label: "Celular", value: "+55 11 99999-0000" },
        { label: "Outro", value: "(11) 99999-0000" },
      ],
    });
    expect(dup.success).toBe(false);
  });
  it("rejeita telefone repetido depois de normalizar", () => {
    const r = personSchema.safeParse({
      ...base,
      phones: [
        { label: "Celular", value: "(11) 99999-0000" },
        { label: "Outro", value: "11 99999 0000" },
      ],
    });
    expect(r.success).toBe(false);
  });
  it("ignora linhas em branco", () => {
    const r = personSchema.parse({ ...base, emails: [{ label: "Trabalho", value: "  " }], phones: [{ label: "Celular", value: "" }] });
    expect(r.emails).toEqual([]);
    expect(r.phones).toEqual([]);
  });
  it("rejeita rótulo desconhecido", () => {
    expect(personSchema.safeParse({ ...base, emails: [{ label: "Chefe", value: "a@b.com" }] }).success).toBe(false);
  });
  it("aceita LinkedIn em linkedin.com e subdomínios", () => {
    expect(personSchema.parse({ ...base, linkedinUrl: "https://www.linkedin.com/in/ana" }).linkedinUrl).toBe(
      "https://www.linkedin.com/in/ana",
    );
    expect(personSchema.parse({ ...base, linkedinUrl: "https://br.linkedin.com/in/ana" }).linkedinUrl).toBe(
      "https://br.linkedin.com/in/ana",
    );
  });
  it("rejeita LinkedIn fora de linkedin.com ou sem https", () => {
    expect(personSchema.safeParse({ ...base, linkedinUrl: "https://example.com/in/ana" }).success).toBe(false);
    expect(personSchema.safeParse({ ...base, linkedinUrl: "https://linkedin.com.evil.io/in/ana" }).success).toBe(false);
    expect(personSchema.safeParse({ ...base, linkedinUrl: "https://notlinkedin.com/in/ana" }).success).toBe(false);
    expect(personSchema.safeParse({ ...base, linkedinUrl: "http://linkedin.com/in/ana" }).success).toBe(false);
    expect(personSchema.safeParse({ ...base, linkedinUrl: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("WhatsApp", () => {
  it("só para celular rotulado ou 11 dígitos com 9 depois do DDD", () => {
    expect(isWhatsappPhone({ label: "Celular", value: "1133334444" })).toBe(true);
    expect(isWhatsappPhone({ label: "Trabalho", value: "11999990000" })).toBe(true);
    expect(isWhatsappPhone({ label: "Outro", value: "1133334444" })).toBe(false);
    expect(isWhatsappPhone({ label: "Outro", value: "11899990000" })).toBe(false);
  });
  it("monta o link com 55", () => {
    expect(whatsappHref("11999990000")).toBe("https://wa.me/5511999990000");
    expect(whatsappHref("5511999990000")).toBe("https://wa.me/5511999990000");
  });
});
