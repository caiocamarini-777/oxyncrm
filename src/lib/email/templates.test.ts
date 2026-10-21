import { describe, expect, it } from "vitest";
import { inviteEmail, recoveryEmail } from "./templates";

const link = "http://localhost:3000/auth/confirm?token_hash=abc&type=invite&next=/definir-senha";

describe("templates de e-mail", () => {
  it("convite traz assunto e link", () => {
    const m = inviteEmail({ fullName: "Ana", link });
    expect(m.subject).toBe("Seu acesso ao Oxyn CRM");
    expect(m.html).toContain(link.replace(/&/g, "&amp;"));
    expect(m.text).toContain(link);
    expect(m.html).toContain("Ana");
  });
  it("recuperação traz assunto e link", () => {
    const m = recoveryEmail({ link });
    expect(m.subject).toBe("Redefinição de senha do Oxyn CRM");
    expect(m.html).toContain(link.replace(/&/g, "&amp;"));
    expect(m.text).toContain(link);
  });
});
