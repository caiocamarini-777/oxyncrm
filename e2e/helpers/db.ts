import postgres from "postgres";
import { loadEnv } from "./auth";

/**
 * SQL direto no banco de dev (SUPABASE_DB_URL) para montar cenários que os gatilhos não
 * permitem pela API, como uma data de entrada na etapa no passado. Gatilhos ficam desligados
 * só dentro da transação (`session_replication_role = replica`).
 */
export async function withoutTriggers(run: (sql: postgres.TransactionSql) => Promise<unknown>): Promise<void> {
  loadEnv();
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL ausente");
  const sql = postgres(url, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await run(tx);
    });
  } finally {
    await sql.end();
  }
}
