import { describe, expect, it } from "vitest";
import { FREE_EMAIL_DOMAINS, internalDomainsFrom } from "./match-loader";

describe("internalDomainsFrom", () => {
  it("usa o domínio de cada e-mail de perfil, normalizado", () => {
    expect(internalDomainsFrom([" Caio@Oxyn.com.br ", "ana@oxyn.com.br", "bia@equilibrion.com"])).toEqual(
      new Set(["oxyn.com.br", "equilibrion.com"]),
    );
  });

  it("deixa de fora os domínios de e-mail gratuito", () => {
    const domains = internalDomainsFrom([
      "fulano@gmail.com",
      "x@GoogleMail.com",
      "y@outlook.com",
      "z@hotmail.com",
      "w@live.com",
      "v@yahoo.com",
      "u@yahoo.com.br",
      "t@icloud.com",
      "s@bol.com.br",
      "r@uol.com.br",
      "caio@oxyn.com.br",
    ]);
    expect(domains).toEqual(new Set(["oxyn.com.br"]));
  });

  it("ignora e-mails nulos, vazios ou sem domínio", () => {
    expect(internalDomainsFrom([null, "", "semarroba", "fim@"])).toEqual(new Set());
  });

  it("a lista de gratuitos é a da decisão R6", () => {
    expect([...FREE_EMAIL_DOMAINS].sort()).toEqual(
      [
        "bol.com.br",
        "gmail.com",
        "googlemail.com",
        "hotmail.com",
        "icloud.com",
        "live.com",
        "outlook.com",
        "uol.com.br",
        "yahoo.com",
        "yahoo.com.br",
      ].sort(),
    );
  });
});
