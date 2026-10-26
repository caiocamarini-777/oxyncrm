import { describe, expect, it } from "vitest";
import { inviteEmail, recoveryEmail, reminderEmail } from "./templates";

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
  it("lembrete traz assunto, horário de São Paulo e link, com HTML escapado", () => {
    const m = reminderEmail({
      fullName: "Ana",
      subject: "Ligar <b>agora</b>",
      dueAt: "2026-10-24T17:30:00Z",
      link,
    });
    expect(m.subject).toBe("Lembrete: Ligar <b>agora</b>");
    expect(m.html).toContain("Ligar &lt;b&gt;agora&lt;/b&gt;");
    expect(m.html).not.toContain("<b>agora</b>");
    expect(m.html).toContain("14:30");
    expect(m.text).toContain("14:30");
    expect(m.text).toContain(link);
    expect(m.html).toContain(link.replace(/&/g, "&amp;"));
  });
});
