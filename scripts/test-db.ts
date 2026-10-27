// Roda supabase/tests/*.sql (pgTAP) sobre SUPABASE_DB_URL e valida a saida TAP.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { loadEnv, requireDbUrl } from "./load-env";

loadEnv();

const dir = resolve(process.cwd(), "supabase/tests");
// pnpm test:db [trecho do nome]: roda só os arquivos que contêm o trecho
const only = process.argv[2];
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql") && (!only || f.includes(only)))
  .sort();

if (files.length === 0) {
  console.log("Nenhum teste de banco");
  process.exit(0);
}

async function main() {
  const sql = postgres(requireDbUrl(), { max: 1, onnotice: () => {} });
  let failed = false;

  try {
    await sql.unsafe(
      "create extension if not exists pgtap with schema extensions",
    );

    for (const file of files) {
      console.log(`# ${file}`);
      try {
        const results = (await sql
          .unsafe(readFileSync(join(dir, file), "utf8"))
          .simple()) as unknown as Array<Array<Record<string, unknown>>>;
        const sets =
          Array.isArray(results) && Array.isArray(results[0])
            ? results
            : [results as never];
        let plan: number | null = null;
        let count = 0;
        for (const set of sets) {
          for (const row of set as Array<Record<string, unknown>>) {
            for (const value of Object.values(row)) {
              if (typeof value !== "string") continue;
              for (const line of value.split("\n")) {
                if (!/^(ok|not ok|1\.\.|#)/.test(line)) continue;
                console.log(line);
                const planMatch = /^1\.\.(\d+)/.exec(line);
                if (planMatch) plan = Number(planMatch[1]);
                if (/^(ok|not ok)\b/.test(line)) count++;
                if (
                  /^not ok/.test(line) ||
                  /^# Looks like you (planned|failed)/.test(line)
                ) {
                  failed = true;
                }
              }
            }
          }
        }
        if (plan === null) {
          failed = true;
          console.error(`ERRO em ${file}: sem linha de plano (1..N)`);
        } else if (count === 0 || count !== plan) {
          failed = true;
          console.error(
            `ERRO em ${file}: plano ${plan}, resultados ${count}`,
          );
        }
      } catch (err) {
        failed = true;
        console.error(`ERRO em ${file}: ${(err as Error).message}`);
      } finally {
        // Um arquivo que falha no meio deixa a transação aberta; limpa antes do próximo.
        await sql.unsafe("rollback").catch(() => {});
      }
    }
  } finally {
    await sql.end();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
