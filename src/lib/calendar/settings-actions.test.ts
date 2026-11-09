import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const state = vi.hoisted(() => ({
  profile: { id: "u-1", isSuperAdmin: true, active: true } as { id: string; isSuperAdmin: boolean; active: boolean } | null,
  db: null as unknown,
  afterActivityWrite: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentProfile: async () => state.profile,
  // Como o real: quem não é admin geral não passa (`notFound()` lança).
  requireSuperAdmin: async () => {
    if (!state.profile?.isSuperAdmin) throw new Error("NEXT_NOT_FOUND");
    return state.profile;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => state.db }));
vi.mock("./activity-hooks", () => ({ afterActivityWrite: (id: string) => state.afterActivityWrite(id) }));

import { revalidatePath } from "next/cache";
import { fakeDb, type Row, type Tables } from "@/lib/meet/fake-db.test-support";
import { retryCalendarSync, saveCalendarSync } from "./settings-actions";

const CO = "11111111-1111-4111-8111-111111111111";
const ACT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const company = (over: Row = {}): Row => ({
  id: CO,
  settings: { meeting_assistant: { enabled: true, questions: ["Dor"] } },
  updated_at: "2026-11-09T12:00:00.000Z",
  archived_at: null,
  ...over,
});

function use(tables: Tables) {
  const fake = fakeDb(tables);
  state.db = fake.db;
  return fake;
}

beforeEach(() => {
  state.profile = { id: "u-1", isSuperAdmin: true, active: true };
  state.afterActivityWrite.mockReset();
  vi.mocked(revalidatePath).mockClear();
});

describe("saveCalendarSync", () => {
  it("ligar grava enabled_at e preserva as outras chaves de settings", async () => {
    const t: Tables = { companies: [company()] };
    use(t);
    expect(await saveCalendarSync(CO, true)).toEqual({ ok: true, data: undefined });
    const settings = t.companies[0].settings as Record<string, { enabled: boolean; enabled_at: string }>;
    expect(settings.calendar_sync.enabled).toBe(true);
    expect(Number.isNaN(Date.parse(settings.calendar_sync.enabled_at))).toBe(false);
    expect(settings.meeting_assistant).toEqual({ enabled: true, questions: ["Dor"] });
    expect(revalidatePath).toHaveBeenCalledWith("/configuracoes/agenda");
  });

  it("desligar mantém o enabled_at de quando foi ligada", async () => {
    const t: Tables = {
      companies: [company({ settings: { calendar_sync: { enabled: true, enabled_at: "2026-11-11T12:00:00.000Z" } } })],
    };
    use(t);
    expect((await saveCalendarSync(CO, false)).ok).toBe(true);
    expect(t.companies[0].settings).toEqual({ calendar_sync: { enabled: false, enabled_at: "2026-11-11T12:00:00.000Z" } });
  });

  it("não envia nada na hora: quem adota e cria os eventos é a primeira rodada do cron", async () => {
    use({ companies: [company()] });
    await saveCalendarSync(CO, true);
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });

  it("só o admin geral: outro usuário não chega a ler nem gravar", async () => {
    const t: Tables = { companies: [company()] };
    const { log } = use(t);
    state.profile = { id: "u-2", isSuperAdmin: false, active: true };
    await expect(saveCalendarSync(CO, true)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(log).toEqual([]);
    expect(t.companies[0].settings).toEqual(company().settings);
  });

  it.each([
    ["id que não é uuid", "x", true],
    ["valor que não é booleano", CO, "true" as unknown as boolean],
    ["valor ausente", CO, undefined as unknown as boolean],
  ])("%s: dados inválidos, sem gravar", async (_, id, enabled) => {
    const { log } = use({ companies: [company()] });
    expect(await saveCalendarSync(id, enabled)).toEqual({ ok: false, error: "Dados inválidos." });
    expect(log).toEqual([]);
  });

  it("empresa que não existe ou está arquivada não é editada", async () => {
    const t: Tables = { companies: [company({ archived_at: "2026-10-01T00:00:00.000Z" })] };
    use(t);
    expect(await saveCalendarSync(CO, true)).toEqual({ ok: false, error: "Empresa não encontrada." });
    expect(await saveCalendarSync("22222222-2222-4222-8222-222222222222", true)).toEqual({
      ok: false,
      error: "Empresa não encontrada.",
    });
    expect(t.companies[0].settings).toEqual(company().settings);
  });

  it("empresa alterada no meio da gravação: lê de novo e tenta outra vez", async () => {
    const t: Tables = { companies: [company()] };
    const fake = use(t);
    const realFrom = (fake.db as unknown as { from(t: string): Record<string, unknown> }).from.bind(fake.db);
    let bumps = 1;
    state.db = {
      from(table: string) {
        const chain = realFrom(table);
        const update = chain.update as (v: Row) => unknown;
        // Outra gravação passa na frente, uma vez, entre a leitura e o update.
        chain.update = (v: Row) => {
          if (table === "companies" && bumps-- > 0) t.companies[0].updated_at = "2026-11-09T12:00:01.000Z";
          return update(v);
        };
        return chain;
      },
    };
    expect((await saveCalendarSync(CO, true)).ok).toBe(true);
    expect(bumps).toBe(-1); // dois updates: o primeiro perdeu a corrida, o segundo valeu
    expect((t.companies[0].settings as { calendar_sync: { enabled: boolean } }).calendar_sync.enabled).toBe(true);
  });

  it("empresa que muda a cada tentativa: desiste com mensagem, sem gravar", async () => {
    const t: Tables = { companies: [company()] };
    const fake = use(t);
    const realFrom = (fake.db as unknown as { from(t: string): Record<string, unknown> }).from.bind(fake.db);
    let n = 0;
    state.db = {
      from(table: string) {
        const chain = realFrom(table);
        const update = chain.update as (v: Row) => unknown;
        chain.update = (v: Row) => {
          if (table === "companies") t.companies[0].updated_at = `2026-11-09T12:00:0${++n}.000Z`;
          return update(v);
        };
        return chain;
      },
    };
    expect(await saveCalendarSync(CO, true)).toEqual({
      ok: false,
      error: "Não foi possível salvar agora. Tente novamente.",
    });
    expect(n).toBe(3);
    expect(t.companies[0].settings).toEqual(company().settings);
  });
});

describe("retryCalendarSync", () => {
  const failed = (over: Row = {}): Row => ({
    id: ACT,
    calendar_state: "error",
    calendar_error: "O Google recusou",
    calendar_attempts: 3,
    subject: "Demo",
    ...over,
  });

  it("zera as tentativas, marca pendente pelo cliente do usuário e envia na hora", async () => {
    const t: Tables = { activities: [failed()] };
    const { log } = use(t);
    expect(await retryCalendarSync(ACT)).toEqual({ ok: true, data: undefined });
    expect(t.activities[0]).toMatchObject({
      calendar_state: "pending",
      calendar_attempts: 0,
      calendar_error: null,
      subject: "Demo",
    });
    expect(state.afterActivityWrite).toHaveBeenCalledWith(ACT);
    // A gravação é um update direto do usuário (a RLS confere a edição), sem função de serviço.
    expect(log.filter((l) => l.op === "rpc")).toEqual([]);
    expect(log.filter((l) => l.table === "activities" && l.op === "update")).toHaveLength(1);
  });

  it("o envio vem depois de marcar pendente", async () => {
    const t: Tables = { activities: [failed()] };
    use(t);
    let seen: unknown;
    state.afterActivityWrite.mockImplementation(() => (seen = t.activities[0].calendar_state));
    await retryCalendarSync(ACT);
    expect(seen).toBe("pending");
  });

  it.each([
    ["pendente", "pending"],
    ["em dia", "synced"],
    ["fora da fila (Agenda desligada)", "none"],
  ])("atividade %s: não há o que tentar de novo, e nada é alterado nem enviado", async (_, calendar_state) => {
    const t: Tables = { activities: [failed({ calendar_state, calendar_attempts: 0, calendar_error: null })] };
    use(t);
    const r = await retryCalendarSync(ACT);
    expect(r.ok).toBe(false);
    expect(t.activities[0]).toMatchObject({ calendar_state, calendar_attempts: 0 });
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });

  it("atividade que não existe ou que o usuário não enxerga (a RLS devolve nenhuma linha): não envia", async () => {
    use({ activities: [] });
    expect((await retryCalendarSync(ACT)).ok).toBe(false);
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });

  it("id inválido ou sem sessão: recusa sem tocar no banco", async () => {
    const { log } = use({ activities: [failed()] });
    expect(await retryCalendarSync("x")).toEqual({ ok: false, error: "Dados inválidos." });
    state.profile = null;
    expect(await retryCalendarSync(ACT)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
    expect(log).toEqual([]);
    expect(state.afterActivityWrite).not.toHaveBeenCalled();
  });
});
