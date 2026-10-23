import { readFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), ".e2e-outbox", "emails.jsonl");

/** Último e-mail para `to`: devolve o primeiro link /auth/confirm do html. */
export async function getLatestLink(to: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const lines = (await readFile(FILE, "utf8")).split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        const msg = JSON.parse(lines[i]) as { to: string; html: string };
        if (msg.to !== to) continue;
        const m = msg.html.match(/href="([^"]*\/auth\/confirm[^"]*)"/);
        if (m) return m[1].replace(/&amp;/g, "&");
      }
    } catch {
      // arquivo ainda não existe
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Nenhum e-mail com link para ${to} em 10 s.`);
}

/** Todas as mensagens gravadas no outbox de arquivo para `to`. */
export async function getMessages(to: string): Promise<{ to: string; subject: string; html: string; text: string }[]> {
  try {
    const lines = (await readFile(FILE, "utf8")).split("\n").filter(Boolean);
    return lines.map((l) => JSON.parse(l) as { to: string; subject: string; html: string; text: string }).filter((m) => m.to === to);
  } catch {
    return [];
  }
}
