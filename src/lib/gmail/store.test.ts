import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { ParsedMessage } from "./parse";
import { storeMessage } from "./store";

type Call = { table: string; op: string; args: unknown[] };

/** Cliente Supabase falso: registra as chamadas e devolve o que o teste mandar. */
function fakeDb(thread: { id: string; subject: string; last_message_at: string | null }, linkRows = [{ id: "L1" }]) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const rec = (op: string) => (...args: unknown[]) => {
        calls.push({ table, op, args });
        return chain;
      };
      for (const op of ["upsert", "update", "select", "eq"]) chain[op] = rec(op);
      chain.single = async () => ({ data: thread, error: null });
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ data: table === "email_links" ? linkRows : null, error: null });
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const parsed: ParsedMessage = {
  gmailId: "m1",
  threadId: "t1",
  rfcMessageId: "<a@b>",
  subject: "Proposta",
  from: { email: "maria@acme.com", name: "Maria" },
  to: [{ email: "ana@oxyn.com", name: null }],
  cc: [],
  sentAt: "2026-05-01T10:00:00.000Z",
  snippet: "oi",
  html: "<p>oi</p>",
  text: "oi",
  attachments: [],
  historyId: "1",
};
const account = { id: "acc", company_id: "co", email: "ana@oxyn.com", history_id: null, backfill_page_token: null, backfill_done: false };

describe("storeMessage", () => {
  it("conversa e mensagem usam upsert pelas chaves únicas; vínculos usam ignoreDuplicates (não reativam)", async () => {
    const { db, calls } = fakeDb({ id: "thr", subject: "", last_message_at: null });
    const r = await storeMessage(db, account, parsed, [{ entity: "persons", recordId: "p1" }, { entity: "leads", recordId: "l1" }]);

    const upserts = calls.filter((c) => c.op === "upsert");
    expect(upserts.map((c) => [c.table, c.args[1]])).toEqual([
      ["email_threads", { onConflict: "account_id,gmail_thread_id", ignoreDuplicates: true }],
      ["email_messages", { onConflict: "account_id,gmail_message_id" }],
      ["email_links", { onConflict: "thread_id,entity,record_id", ignoreDuplicates: true }],
    ]);
    const msgRow = upserts[1].args[0] as Record<string, unknown>;
    expect(msgRow).toMatchObject({ thread_id: "thr", account_id: "acc", direction: "in", body_html: "<p>oi</p>", rfc_message_id: "<a@b>" });
    expect(upserts[2].args[0]).toEqual([
      { thread_id: "thr", entity: "persons", record_id: "p1", origin: "auto" },
      { thread_id: "thr", entity: "leads", record_id: "l1", origin: "auto" },
    ]);
    // o vínculo automático nunca grava unlinked_at/linked_by (e não atualiza o existente)
    expect(JSON.stringify(upserts[2].args[0])).not.toContain("unlinked");
    expect(r.linksInserted).toBe(1); // só conta o que foi realmente inserido
  });

  it("atualiza a conversa só quando muda (assunto original e data maior)", async () => {
    const { db, calls } = fakeDb({ id: "thr", subject: "Re: Proposta", last_message_at: "2026-04-01T00:00:00.000Z" });
    await storeMessage(db, account, parsed, []);
    expect(calls.find((c) => c.table === "email_threads" && c.op === "update")?.args[0]).toEqual({
      subject: "Proposta",
      last_message_at: "2026-05-01T10:00:00.000Z",
    });
    expect(calls.some((c) => c.table === "email_links")).toBe(false);

    const same = fakeDb({ id: "thr", subject: "Proposta", last_message_at: "2026-06-01T00:00:00.000Z" });
    await storeMessage(same.db, account, parsed, []);
    expect(same.calls.some((c) => c.op === "update")).toBe(false);
  });
});
