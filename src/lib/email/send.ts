import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const explicit = process.env.EMAIL_TRANSPORT;
  if (!explicit && process.env.NODE_ENV === "production") {
    throw new Error("EMAIL_TRANSPORT não configurado");
  }
  const transport = explicit || "file";
  if (transport === "file") {
    const dir = path.join(process.cwd(), ".e2e-outbox");
    await mkdir(dir, { recursive: true });
    await appendFile(
      path.join(dir, "emails.jsonl"),
      JSON.stringify({ ...msg, sentAt: new Date().toISOString() }) + "\n",
    );
    return;
  }
  if (transport === "resend") {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) {
      throw new Error("EMAIL_TRANSPORT=resend exige RESEND_API_KEY e EMAIL_FROM.");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      throw new Error(`Falha ao enviar e-mail (Resend ${res.status}).`);
    }
    return;
  }
  throw new Error(`EMAIL_TRANSPORT desconhecido: ${transport}`);
}
