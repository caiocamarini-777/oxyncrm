// Chama a rota de lembretes por e-mail localmente: pnpm reminders:send
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET ausente. Defina em .env.local.");
    process.exit(1);
  }
  const base = (process.env.REMINDERS_URL || "http://localhost:3000").replace(/\/$/, "");
  const res = await fetch(`${base}/api/cron/lembretes`, { headers: { Authorization: `Bearer ${secret}` } });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Falha (${res.status}): ${body}`);
    process.exit(1);
  }
  console.log(body);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
