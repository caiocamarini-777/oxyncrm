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

/** Colunas que `calendar_mark_synced` grava; as demais chaves de `p_fields` são ignoradas, como no banco. */
const CALENDAR_FIELDS = [
  "calendar_account_id",
  "calendar_event_id",
  "calendar_etag",
  "calendar_state",
  "calendar_error",
  "calendar_attempts",
  "meet_url",
];

/** Colunas que `calendar_apply_inbound` grava (horário, título, conclusão, lixeira e vínculo com o evento). */
const INBOUND_FIELDS = [
  "subject",
  "due_at",
  "duration_minutes",
  "deleted_at",
  "done",
  "completed_at",
  "meeting_outcome",
  "calendar_account_id",
  "calendar_event_id",
  "calendar_etag",
  "calendar_state",
  "meet_url",
];

/** Colunas que `calendar_insert_inbound` aceita; as demais ficam com o padrão da tabela. */
const INSERT_INBOUND_FIELDS = [
  "company_id",
  "owner_id",
  "type_id",
  "channel_id",
  "subject",
  "description",
  "due_at",
  "duration_minutes",
  "lead_id",
  "deal_id",
  "person_id",
  "organization_id",
  "calendar_account_id",
  "calendar_event_id",
  "calendar_etag",
  "calendar_state",
  "calendar_error",
  "calendar_attempts",
  "meet_url",
];

/** Check `done = (completed_at is not null)` da tabela `activities`. */
function checkCompletion(row: Row): void {
  if ((row.done === true) !== (row.completed_at != null)) {
    throw new Error("violação do check activities: done e completed_at precisam andar juntos");
  }
}

/**
 * Funções do banco (`db.rpc`) que os testes usam: recebem as tabelas e os argumentos e devolvem o `data`. O banco
 * falso não tem gatilhos, então a marca de sessão (`oxyn.calendar_inbound`) não tem efeito aqui; quem testa confere
 * pelo `log` que a gravação passou pela função.
 */
const RPCS: Record<string, (tables: Tables, args: Row) => unknown> = {
  // Volta do envio à Agenda: só as colunas da Agenda; chave ausente mantém o valor, chave com null grava null.
  calendar_mark_synced: (tables, args) => {
    const row = (tables.activities ?? []).find((r) => r.id === args.p_activity);
    const fields = (args.p_fields ?? {}) as Row;
    if (row) for (const k of CALENDAR_FIELDS) if (k in fields) row[k] = structuredClone(fields[k]);
    return null;
  },
  // Entrada da Agenda numa atividade que existe: mesma regra de chave ausente / null; confere o check de conclusão.
  calendar_apply_inbound: (tables, args) => {
    const row = (tables.activities ?? []).find((r) => r.id === args.p_activity);
    const patch = (args.p_patch ?? {}) as Row;
    if (!row) return null;
    const next = { ...row };
    for (const k of INBOUND_FIELDS) if (k in patch) next[k] = structuredClone(patch[k]);
    checkCompletion(next);
    Object.assign(row, next);
    return null;
  },
  // Evento novo da Agenda: insere com os padrões da tabela e devolve o id.
  calendar_insert_inbound: (tables, args) => {
    const input = (args.p_row ?? {}) as Row;
    const row: Row = {
      id: `ga${++seq}`,
      source: "google_calendar",
      created_by: input.owner_id ?? null,
      description: null,
      duration_minutes: 30,
      done: false,
      completed_at: null,
      meeting_outcome: null,
      deleted_at: null,
      lead_id: null,
      deal_id: null,
      person_id: null,
      organization_id: null,
      calendar_account_id: null,
      calendar_event_id: null,
      calendar_etag: null,
      calendar_state: "none",
      calendar_error: null,
      calendar_attempts: 0,
      meet_url: null,
    };
    for (const k of INSERT_INBOUND_FIELDS) if (k in input && input[k] != null) row[k] = structuredClone(input[k]);
    (tables.activities ??= []).push(row);
    return row.id;
  },
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
 * `.rpc` executa as funções de `RPCS` (função desconhecida devolve o erro PGRST202) e entra no `log` como
 * `{ table: <função>, op: "rpc", values: <argumentos> }`. Função que lança (check violado) rejeita a promessa.
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
    rpc(name: string, args: Row = {}) {
      log.push({ table: name, op: "rpc", values: args });
      const fn = RPCS[name];
      if (!fn) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `função ${name} não existe` } });
      try {
        return Promise.resolve({ data: fn(tables, args), error: null });
      } catch (e) {
        return Promise.reject(e);
      }
    },
  } as unknown as SupabaseClient;
  return { db, tables, log };
}
