import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("criptografia de tokens", () => {
  it("ida e volta, inclusive com acentos", () => {
    const enc = encryptToken("1//refresh-ção", key);
    expect(decryptToken(enc, key)).toBe("1//refresh-ção");
  });

  it("usa o formato v1.<iv>.<tag>.<dados> e iv diferente a cada vez", () => {
    const a = encryptToken("x", key);
    const b = encryptToken("x", key);
    expect(a.split(".")).toHaveLength(4);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toBe(b);
  });

  it("recusa chave com tamanho errado", () => {
    const curta = randomBytes(16).toString("base64");
    expect(() => encryptToken("x", curta)).toThrow();
    expect(() => decryptToken("v1.a.b.c", curta)).toThrow();
  });

  it("recusa outra chave e dados adulterados", () => {
    const enc = encryptToken("segredo", key);
    expect(() => decryptToken(enc, randomBytes(32).toString("base64"))).toThrow();
    const [v, iv, tag, data] = enc.split(".");
    const adulterado = [v, iv, tag, Buffer.from("outro").toString("base64url")].join(".");
    expect(() => decryptToken(adulterado, key)).toThrow();
    expect(data).toBeTruthy();
  });

  it("recusa formato desconhecido", () => {
    expect(() => decryptToken("lixo", key)).toThrow();
    expect(() => decryptToken("v2.a.b.c", key)).toThrow();
  });
});
