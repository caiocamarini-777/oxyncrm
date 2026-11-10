import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeDb, type Row } from "./fake-db.test-support";
import { meetingSinkMode, mirrorActive, MIRROR_ACTIVE_ERROR, MIRROR_GUARD_MS } from "./sink-mode";

describe("meetingSinkMode", () => {
  it('"crm" vale crm', () => {
    expect(meetingSinkMode("crm")).toBe("crm");
  });

  it('"pipedrive" vale pipedrive', () => {
    expect(meetingSinkMode("pipedrive")).toBe("pipedrive");
  });

  it("ausente ou vazio vale pipedrive", () => {
    expect(meetingSinkMode(undefined)).toBe("pipedrive");
    expect(meetingSinkMode("")).toBe("pipedrive");
  });

  it("espaços e maiúsculas são normalizados antes de comparar", () => {
    expect(meetingSinkMode("CRM ")).toBe("crm");
    expect(meetingSinkMode("  Crm")).toBe("crm");
    expect(meetingSinkMode(" PIPEDRIVE ")).toBe("pipedrive");
  });

  it("valor inválido vale pipedrive", () => {
    expect(meetingSinkMode("xyz")).toBe("pipedrive");
  });

  it("sem argumento, lê MEETING_SINK do ambiente", () => {
    const before = process.env.MEETING_SINK;
    try {
      process.env.MEETING_SINK = "crm";
      expect(meetingSinkMode()).toBe("crm");
      delete process.env.MEETING_SINK;
      expect(meetingSinkMode()).toBe("pipedrive");
    } finally {
      if (before === undefined) delete process.env.MEETING_SINK;
      else process.env.MEETING_SINK = before;
    }
  });
});

describe("constantes da trava do espelho", () => {
  it("48 horas e a mensagem da spec", () => {
    expect(MIRROR_GUARD_MS).toBe(48 * 3600_000);
    expect(MIRROR_ACTIVE_ERROR).toBe("modo espelho ativo: o Pipedrive apagaria o que fosse gravado no CRM");
  });
});

describe("mirrorActive", () => {
  const NOW = new Date("2026-11-12T12:00:00.000Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
  const job = (over: Row = {}): Row => ({
    id: "j1",
    source: "pipedrive",
    status: "done",
    mirror: true,
    finished_at: hoursAgo(2),
    ...over,
  });
  const run = (jobs: Row[]) => mirrorActive(fakeDb({ import_jobs: jobs }).db, NOW);

  it("espelho que terminou há 2 h: ativo", async () => {
    expect(await run([job()])).toBe(true);
  });

  it("espelho que terminou há 49 h: inativo", async () => {
    expect(await run([job({ finished_at: hoursAgo(49) })])).toBe(false);
  });

  it("o limite de 48 h já não conta como ativo", async () => {
    expect(await run([job({ finished_at: hoursAgo(48) })])).toBe(false);
  });

  it("último job sem espelho: inativo", async () => {
    expect(await run([job({ mirror: false })])).toBe(false);
  });

  it("sem nenhum job: inativo", async () => {
    expect(await run([])).toBe(false);
  });

  it("vale só o último job concluído: um espelho antigo não conta se o último não é espelho", async () => {
    expect(await run([job({ id: "velho", finished_at: hoursAgo(30) }), job({ id: "novo", mirror: false, finished_at: hoursAgo(1) })])).toBe(
      false,
    );
  });

  it("vale só o último job concluído: espelho recente vale mesmo com um job sem espelho mais antigo", async () => {
    expect(await run([job({ id: "velho", mirror: false, finished_at: hoursAgo(30) }), job({ id: "novo", finished_at: hoursAgo(1) })])).toBe(
      true,
    );
  });

  it("ignora job que não terminou (rodando, pausado, falho)", async () => {
    expect(await run([job({ status: "running", finished_at: null }), job({ status: "failed", finished_at: hoursAgo(1) })])).toBe(false);
  });

  it("job concluído sem finished_at não vira o último", async () => {
    expect(await run([job({ id: "velho", finished_at: hoursAgo(1) }), job({ id: "sem-data", finished_at: null })])).toBe(true);
  });

  it("falha ao ler os jobs lança erro em vez de liberar a gravação", async () => {
    const broken = {
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "not", "order", "limit"]) chain[m] = () => chain;
        chain.maybeSingle = () => Promise.resolve({ data: null, error: { message: "boom" } });
        return chain;
      },
    } as unknown as SupabaseClient;
    await expect(mirrorActive(broken, NOW)).rejects.toThrow("boom");
  });
});
