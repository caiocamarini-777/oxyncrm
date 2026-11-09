import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  profile: { id: "u-1" } as { id: string } | null,
  /** O que cada operação do banco devolve (`from(...)` pelo último de insert/update/select; `rpc` pelo nome). */
  results: {} as Record<string, { data?: unknown; error?: { code?: string; message?: string } | null }>,
  /** Ordem das chamadas relevantes, para conferir que o envio vem depois da gravação. */
  order: [] as string[],
  afterActivityWrite: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/calendar/activity-hooks", () => ({
  afterActivityWrite: async (id: string) => {
    state.order.push(`push:${id}`);
    await state.afterActivityWrite(id);
  },
}));

/** Cliente falso: cada cadeia de `from` termina (`then`, `single`, `maybeSingle`) na resposta da última operação. */
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from() {
      let op = "select";
      const chain: Record<string, unknown> = {};
      const answer = () => {
        state.order.push(`db:${op}`);
        const r = state.results[op] ?? {};
        return { data: r.data ?? null, error: r.error ?? null };
      };
      for (const m of ["eq", "is", "select"]) chain[m] = () => chain;
      chain.insert = () => ((op = "insert"), chain);
      chain.update = () => ((op = "update"), chain);
      chain.single = async () => answer();
      chain.maybeSingle = async () => answer();
      chain.then = (resolve: (v: unknown) => void) => resolve(answer());
      return chain;
    },
    async rpc(name: string) {
      state.order.push(`rpc:${name}`);
      const r = state.results[name] ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    },
  }),
}));

import {
  completeActivity,
  createActivity,
  reopenActivity,
  restoreActivity,
  trashActivity,
  updateActivity,
} from "./actions";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEETING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NEXT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TYPE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHANNEL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DEAL = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const input = { typeId: TYPE, channelId: CHANNEL, subject: "Demo", dueAt: "2026-11-10T14:00", dealId: DEAL };
const DB_ERROR = { code: "42501", message: "permission denied" };

beforeEach(() => {
  state.profile = { id: "u-1" };
  state.results = {};
  state.order = [];
  state.afterActivityWrite.mockReset();
});

describe("envio para a Agenda depois de gravar", () => {
  it("createActivity: envia a atividade criada, depois de inserir", async () => {
    state.results.insert = { data: { id: A } };
    expect(await createActivity(COMPANY, input)).toEqual({ ok: true, data: { id: A } });
    expect(state.afterActivityWrite).toHaveBeenCalledTimes(1);
    expect(state.afterActivityWrite).toHaveBeenCalledWith(A);
    expect(state.order).toEqual(["db:insert", `push:${A}`]);
  });

  it("createActivity: sem gravar (erro do banco, dados inválidos), não envia", async () => {
    state.results.insert = { error: DB_ERROR };
    expect((await createActivity(COMPANY, input)).ok).toBe(false);
    expect((await createActivity(COMPANY, { ...input, subject: "" })).ok).toBe(false);
    expect((await createActivity("x", input)).ok).toBe(false);
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });

  it("updateActivity: envia a atividade editada, depois do update", async () => {
    state.results.select = { data: { owner_id: "u-1", done: false, deal_id: DEAL } };
    state.results.update = { data: [{ id: A }] };
    expect(await updateActivity(A, input)).toEqual({ ok: true, data: undefined });
    expect(state.afterActivityWrite).toHaveBeenCalledWith(A);
    expect(state.order.at(-2)).toBe("db:update");
    expect(state.order.at(-1)).toBe(`push:${A}`);
  });

  it("updateActivity: registro que não existe, sem permissão ou com erro, não envia", async () => {
    state.results.select = { data: null };
    expect((await updateActivity(A, input)).ok).toBe(false);
    state.results.select = { data: { owner_id: "u-1", done: false, deal_id: DEAL } };
    state.results.update = { data: [] };
    expect((await updateActivity(A, input)).ok).toBe(false);
    state.results.update = { error: DB_ERROR };
    expect((await updateActivity(A, input)).ok).toBe(false);
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });

  it("updateActivity: trocar o responsável (reassign_record) também envia, uma vez, no fim", async () => {
    const OWNER = "99999999-9999-4999-8999-999999999999";
    state.results.select = { data: { owner_id: "u-1", done: false, deal_id: DEAL } };
    state.results.update = { data: [{ id: A }] };
    expect((await updateActivity(A, { ...input, ownerId: OWNER })).ok).toBe(true);
    expect(state.order).toContain("rpc:reassign_record");
    expect(state.afterActivityWrite).toHaveBeenCalledTimes(1);
    expect(state.order.at(-1)).toBe(`push:${A}`);
  });

  it("updateActivity: se a troca de responsável falha, nada foi salvo e nada é enviado", async () => {
    const OWNER = "99999999-9999-4999-8999-999999999999";
    state.results.select = { data: { owner_id: "u-1", done: false, deal_id: DEAL } };
    state.results.reassign_record = { error: DB_ERROR };
    expect((await updateActivity(A, { ...input, ownerId: OWNER })).ok).toBe(false);
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });

  describe("completeActivity", () => {
    const complete = { isMeeting: false, outcomeId: "12121212-1212-4121-8121-121212121212" };

    it("envia a atividade concluída e as que a conclusão criou (reunião e próxima)", async () => {
      state.results.complete_activity = { data: { meeting_id: MEETING, next_id: NEXT, rule: "off" } };
      expect(await completeActivity(A, complete)).toEqual({
        ok: true,
        data: { meetingId: MEETING, nextId: NEXT, rule: "off" },
      });
      expect(state.afterActivityWrite).toHaveBeenCalledTimes(3);
      expect(state.afterActivityWrite.mock.calls.map((c) => c[0]).sort()).toEqual([A, MEETING, NEXT].sort());
      // Nenhum envio antes da conclusão gravada.
      expect(state.order[0]).toBe("rpc:complete_activity");
    });

    it("sem reunião nem próxima, envia só a concluída", async () => {
      state.results.complete_activity = { data: { meeting_id: null, next_id: null, rule: "off" } };
      expect((await completeActivity(A, complete)).ok).toBe(true);
      expect(state.afterActivityWrite.mock.calls).toEqual([[A]]);
    });

    it("com só a próxima atividade criada, envia a concluída e a próxima", async () => {
      state.results.complete_activity = { data: { next_id: NEXT } };
      expect((await completeActivity(A, complete)).ok).toBe(true);
      expect(state.afterActivityWrite.mock.calls.map((c) => c[0]).sort()).toEqual([A, NEXT].sort());
    });

    it("conclusão recusada pelo banco não envia nada", async () => {
      state.results.complete_activity = { error: { message: "OXYN_ALREADY_DONE" } };
      expect((await completeActivity(A, complete)).ok).toBe(false);
      expect((await completeActivity(A, { isMeeting: false })).ok).toBe(false);
      expect(state.afterActivityWrite).not.toHaveBeenCalled();
    });
  });

  it("reopenActivity: envia a atividade reaberta (o evento volta a ficar aberto)", async () => {
    expect(await reopenActivity(A)).toEqual({ ok: true, data: undefined });
    expect(state.afterActivityWrite).toHaveBeenCalledWith(A);
    state.afterActivityWrite.mockClear();
    state.results.reopen_activity = { error: { message: "OXYN_NOT_DONE" } };
    expect((await reopenActivity(A)).ok).toBe(false);
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });

  it.each([
    ["trashActivity", trashActivity],
    ["restoreActivity", restoreActivity],
  ])("%s: envia a atividade (o evento sai da Agenda ou volta a ela), depois do update", async (_, action) => {
    state.results.update = { data: [{ id: A }] };
    expect(await action(A)).toEqual({ ok: true, data: undefined });
    expect(state.afterActivityWrite).toHaveBeenCalledWith(A);
    expect(state.order).toEqual(["db:update", `push:${A}`]);
  });

  it.each([
    ["trashActivity", trashActivity],
    ["restoreActivity", restoreActivity],
  ])("%s: sem linha alterada, com erro, id inválido ou sem sessão, não envia", async (_, action) => {
    state.results.update = { data: [] };
    expect((await action(A)).ok).toBe(false);
    state.results.update = { error: DB_ERROR };
    expect((await action(A)).ok).toBe(false);
    expect((await action("x")).ok).toBe(false);
    state.profile = null;
    expect((await action(A)).ok).toBe(false);
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });

  it("o envio é aguardado antes de responder (a tela já vê o estado da Agenda)", async () => {
    let finished = false;
    state.afterActivityWrite.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      finished = true;
    });
    state.results.update = { data: [{ id: A }] };
    await trashActivity(A);
    expect(finished).toBe(true);
  });
});
