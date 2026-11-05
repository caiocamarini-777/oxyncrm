/**
 * Banco em memória dos testes do assistente de reuniões (rodada do cron e ações do vendedor). Só os testes
 * importam este arquivo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

/** Chaves únicas que o banco de verdade garante (as que a rodada e as ações dependem). */
const UNIQUE: Record<string, string[]> = {
  meetings: ["conference_record"],
  meeting_transcripts: ["meeting_id"],
  meeting_notes: ["meeting_id"],
  meeting_suggestions: ["meeting_id", "kind"],
  notifications: ["meeting_id", "kind", "user_id"],
};

/** Tabelas com o trigger `set_updated_at` (o banco grava `now()` em todo update). */
const TOUCHED = new Set(["meetings"]);

let seq = 0;
/** Zera os ids gerados (`m1`, `s2`...), para cada teste começar do mesmo ponto. */
export function resetSeq(): void {
  seq = 0;
}

const DEFAULTS: Record<string, () => Row> = {
  meetings: () => ({
    id: `m${++seq}`,
    status: "waiting_transcript",
    attempts: 0,
    last_error: null,
    entity: null,
    record_id: null,
    anchor_activity_id: null,
    calendar_event_id: null,
    attendees: [],
    title: "",
    updated_at: "2026-11-05T15:00:00.000Z",
  }),
  meeting_notes: () => ({ pipedrive_note_id: null, written_at: null }),
  meeting_suggestions: () => ({ id: `s${++seq}`, status: "pending", decided_by: null, decided_at: null, last_error: null }),
  notifications: () => ({ id: ++seq, read_at: null }),
};

const time = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const ta = time(a);
  const tb = time(b);
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}
const unquote = (s: string) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s);

/**
 * Banco falso no padrão do `run.test.ts` do Gmail, mas com estado: as tabelas são listas de linhas e o
 * construtor de consultas entende o vocabulário que a rodada usa (filtros, ordem, insert, upsert com
 * `onConflict`/`ignoreDuplicates`, update, delete e o `.or` do lease). Chave única violada devolve 23505.
 * Com `clock`, imita o trigger `set_updated_at` de `meetings` (insert e update gravam a hora do relógio).
 */
export function fakeDb(tables: Tables, clock?: () => Date) {
  const log: { table: string; op: string; values?: unknown }[] = [];
  /** Insert: o padrão `now()` vale só sem valor informado. Update: o trigger sempre grava `now()`. */
  const stamp = (table: string, row: Row, inserted?: Row) => {
    if (!clock || !TOUCHED.has(table)) return;
    if (inserted && "updated_at" in inserted) return;
    row.updated_at = clock().toISOString();
  };
  const db = {
    from(table: string) {
      const rows = (tables[table] ??= []);
      let op: "select" | "insert" | "upsert" | "update" | "delete" = "select";
      let payload: Row[] = [];
      let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
      let returning = false;
      let single: "single" | "maybe" | null = null;
      let limit = Infinity;
      const orders: { col: string; asc: boolean }[] = [];
      const filters: ((r: Row) => boolean)[] = [];
      const chain: Record<string, unknown> = {};

      chain.select = () => {
        if (op !== "select") returning = true;
        return chain;
      };
      chain.insert = (v: Row | Row[]) => ((op = "insert"), (payload = Array.isArray(v) ? v : [v]), chain);
      chain.upsert = (v: Row | Row[], o: typeof upsertOpts = {}) => (
        (op = "upsert"), (payload = Array.isArray(v) ? v : [v]), (upsertOpts = o), chain
      );
      chain.update = (v: Row) => ((op = "update"), (payload = [v]), chain);
      chain.delete = () => ((op = "delete"), chain);
      chain.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain);
      // `ilike` sem curingas (o código escapa `%`, `_` e `\`): igualdade sem diferenciar maiúsculas.
      chain.ilike = (c: string, pattern: string) => {
        const literal = pattern.replace(/\\(.)/g, "$1").toLowerCase();
        filters.push((r) => typeof r[c] === "string" && (r[c] as string).toLowerCase() === literal);
        return chain;
      };
      chain.neq = (c: string, v: unknown) => (filters.push((r) => r[c] !== v), chain);
      chain.is = (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), chain);
      chain.not = (c: string, o: string, v: unknown) => (
        filters.push((r) => (o === "is" ? (r[c] ?? null) !== v : true)), chain
      );
      chain.in = (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), chain);
      chain.lt = (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) < 0), chain);
      chain.lte = (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) <= 0), chain);
      chain.gte = (c: string, v: unknown) => (filters.push((r) => r[c] != null && cmp(r[c], v) >= 0), chain);
      chain.or = (expr: string) => {
        const parts = expr.split(",").map((p) => {
          const [col, o, ...rest] = p.split(".");
          const v = unquote(rest.join("."));
          return (r: Row) =>
            o === "is" ? (r[col] ?? null) === null : o === "lt" ? r[col] != null && cmp(r[col], v) < 0 : r[col] === v;
        });
        filters.push((r) => parts.some((f) => f(r)));
        return chain;
      };
      chain.order = (col: string, o: { ascending?: boolean } = {}) => (
        orders.push({ col, asc: o.ascending !== false }), chain
      );
      chain.limit = (n: number) => ((limit = n), chain);
      chain.single = () => ((single = "single"), chain);
      chain.maybeSingle = () => ((single = "maybe"), chain);

      const conflict = (row: Row) => {
        const keys = UNIQUE[table];
        if (!keys) return undefined;
        return rows.find((r) => keys.every((k) => r[k] != null && r[k] === row[k]));
      };

      chain.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        try {
          log.push({ table, op, values: op === "select" || op === "delete" ? undefined : payload });
          const match = rows.filter((r) => filters.every((f) => f(r)));
          let data: Row[] = [];
          if (op === "select") {
            data = [...match];
            for (const o of [...orders].reverse()) data.sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]));
            data = data.slice(0, limit);
          } else if (op === "insert") {
            const fresh = payload.map((v) => {
              const r = { ...(DEFAULTS[table]?.() ?? {}), ...structuredClone(v) };
              stamp(table, r, v);
              return r;
            });
            if (fresh.some((r) => conflict(r))) {
              return resolve({ data: null, error: { code: "23505", message: "duplicate key value" } });
            }
            rows.push(...fresh);
            data = fresh;
          } else if (op === "upsert") {
            for (const v of payload) {
              const existing = conflict(v);
              if (existing) {
                if (upsertOpts.ignoreDuplicates) continue;
                Object.assign(existing, structuredClone(v));
                stamp(table, existing);
                data.push(existing);
              } else {
                const fresh = { ...(DEFAULTS[table]?.() ?? {}), ...structuredClone(v) };
                stamp(table, fresh, v);
                rows.push(fresh);
                data.push(fresh);
              }
            }
          } else if (op === "update") {
            for (const r of match) {
              Object.assign(r, structuredClone(payload[0]));
              stamp(table, r);
            }
            data = match;
          } else {
            for (const r of match) rows.splice(rows.indexOf(r), 1);
            data = match;
          }
          const out = data.map((r) => structuredClone(r));
          if (single) {
            if (single === "single" && out.length !== 1) {
              return resolve({ data: null, error: { code: "PGRST116", message: "esperava uma linha" } });
            }
            return resolve({ data: out[0] ?? null, error: null });
          }
          return resolve({ data: op === "select" || returning ? out : null, error: null });
        } catch (e) {
          if (reject) return reject(e);
          throw e;
        }
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, tables, log };
}
