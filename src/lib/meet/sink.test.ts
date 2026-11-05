import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pipedriveSink, pipedriveUserFor, SinkError, type SinkTarget } from "./sink";

const deal: SinkTarget = { entity: "deals", pipedriveId: "55", personPipedriveId: "7", orgPipedriveId: "9" };
const lead: SinkTarget = {
  entity: "leads",
  pipedriveId: "a1b2c3d4-0000-4000-8000-000000000001",
  personPipedriveId: null,
  orgPipedriveId: null,
};
const person: SinkTarget = { entity: "persons", pipedriveId: "7", personPipedriveId: null, orgPipedriveId: "9" };

function mockFetch(status = 200, body: unknown = { success: true, data: { id: 123 } }) {
  return vi.fn(async (...args: Parameters<typeof fetch>) => {
    void args;
    return new Response(JSON.stringify(body), { status });
  });
}
const call = (f: ReturnType<typeof mockFetch>, i = 0) => {
  const [url, init] = f.mock.calls[i] as [string, RequestInit];
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body ?? "null")),
  };
};

describe("pipedriveSink.writeNote", () => {
  it("negócio: manda deal_id, user_id e o token no header", async () => {
    const f = mockFetch();
    const r = await pipedriveSink({ token: "tok", fetchImpl: f as unknown as typeof fetch }).writeNote(deal, "<b>x</b>", 4);
    expect(r).toEqual({ noteId: 123 });
    const c = call(f);
    expect(c.url).toBe("https://api.pipedrive.com/v1/notes");
    expect(c.method).toBe("POST");
    expect(c.headers["x-api-token"]).toBe("tok");
    expect(c.body).toEqual({ content: "<b>x</b>", deal_id: 55, user_id: 4 });
  });

  it("lead: manda lead_id (uuid) e, sem userId, não manda user_id", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).writeNote(lead, "n", null);
    expect(call(f).body).toEqual({ content: "n", lead_id: lead.pipedriveId });
  });

  it("pessoa: manda person_id", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).writeNote(person, "n", null);
    expect(call(f).body).toEqual({ content: "n", person_id: 7 });
  });
});

describe("pipedriveSink.completeMeeting", () => {
  const args = { outcomeId: 3, subject: "Demo", startedAt: "2026-11-05T17:30:00Z", userId: 4 };

  it("com âncora: PUT na atividade com done 1 e outcome", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).completeMeeting(deal, { ...args, anchorPipedriveId: "88" });
    const c = call(f);
    expect(c.url).toBe("https://api.pipedrive.com/v1/activities/88");
    expect(c.method).toBe("PUT");
    expect(c.body).toEqual({ done: 1, outcome: 3 });
  });

  it("com âncora e sem resultado: só done 1", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).completeMeeting(deal, {
      ...args,
      outcomeId: null,
      anchorPipedriveId: "88",
    });
    expect(call(f).body).toEqual({ done: 1 });
  });

  it("sem âncora: POST de atividade de reunião já concluída", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).completeMeeting(deal, { ...args, anchorPipedriveId: null });
    const c = call(f);
    expect(c.url).toBe("https://api.pipedrive.com/v1/activities");
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({
      subject: "Demo",
      type: "meeting",
      done: 1,
      due_date: "2026-11-05",
      due_time: "17:30",
      user_id: 4,
      deal_id: 55,
      person_id: 7,
      org_id: 9,
      outcome: 3,
    });
  });
});

describe("pipedriveSink.createActivity", () => {
  it("converte data e hora de São Paulo para UTC", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).createActivity(deal, {
      typeKey: "call",
      subject: "Ligar",
      dueDate: "2026-11-12",
      dueTime: "09:00",
      userId: 4,
    });
    const c = call(f);
    expect(c.url).toBe("https://api.pipedrive.com/v1/activities");
    expect(c.body).toMatchObject({ subject: "Ligar", type: "call", due_date: "2026-11-12", due_time: "12:00", user_id: 4, deal_id: 55 });
  });

  it("a conversão pode virar o dia em UTC", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).createActivity(deal, {
      typeKey: "call",
      subject: "x",
      dueDate: "2026-11-12",
      dueTime: "22:30",
      userId: null,
    });
    expect(call(f).body).toMatchObject({ due_date: "2026-11-13", due_time: "01:30" });
    expect(call(f).body).not.toHaveProperty("user_id");
  });

  it("sem hora: manda só a data", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).createActivity(lead, {
      typeKey: "task",
      subject: "x",
      dueDate: "2026-11-12",
      dueTime: null,
      userId: null,
    });
    const b = call(f).body;
    expect(b.due_date).toBe("2026-11-12");
    expect(b).not.toHaveProperty("due_time");
    expect(b.lead_id).toBe(lead.pipedriveId);
  });
});

describe("pipedriveSink.moveStage", () => {
  it("PUT no negócio com stage_id", async () => {
    const f = mockFetch();
    await pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).moveStage("55", 12);
    const c = call(f);
    expect(c.url).toBe("https://api.pipedrive.com/v1/deals/55");
    expect(c.method).toBe("PUT");
    expect(c.body).toEqual({ stage_id: 12 });
  });
});

describe("erros", () => {
  it("resposta não-2xx lança SinkError com status e mensagem, sem vazar o token", async () => {
    const f = mockFetch(500, { success: false, error: "falha interna" });
    const err = await pipedriveSink({ token: "segredo", fetchImpl: f as unknown as typeof fetch })
      .writeNote(deal, "n", null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(SinkError);
    expect(err.status).toBe(500);
    expect(err.message).toContain("falha interna");
    expect(err.message).not.toContain("segredo");
  });

  it("corpo que não é JSON ainda vira SinkError", async () => {
    const f = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(pipedriveSink({ token: "t", fetchImpl: f as unknown as typeof fetch }).moveStage("1", 2)).rejects.toMatchObject({
      name: "SinkError",
      status: 502,
    });
  });
});

describe("pipedriveUserFor", () => {
  function fakeDb(row: unknown, error: { message: string } | null = null) {
    const calls: Array<[string, ...unknown[]]> = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) {
      q[m] = (...a: unknown[]) => {
        calls.push([m, ...a]);
        return q;
      };
    }
    q.maybeSingle = async () => ({ data: row, error });
    return { db: { from: (t: string) => (calls.push(["from", t]), q) } as unknown as SupabaseClient, calls };
  }

  it("inverte mappings.users da última importação concluída", async () => {
    const { db, calls } = fakeDb({ mappings: { users: { "11": "prof-a", "22": "prof-b" } } });
    expect(await pipedriveUserFor(db, "prof-b")).toBe(22);
    expect(calls).toContainEqual(["from", "import_jobs"]);
    expect(calls).toContainEqual(["eq", "status", "done"]);
    expect(calls).toContainEqual(["order", "finished_at", { ascending: false }]);
  });

  it("devolve null sem mapeamento, sem importação ou com dados inesperados", async () => {
    expect(await pipedriveUserFor(fakeDb({ mappings: { users: { "11": "prof-a" } } }).db, "outro")).toBeNull();
    expect(await pipedriveUserFor(fakeDb(null).db, "x")).toBeNull();
    expect(await pipedriveUserFor(fakeDb({ mappings: null }).db, "x")).toBeNull();
  });

  it("propaga erro de leitura", async () => {
    await expect(pipedriveUserFor(fakeDb(null, { message: "boom" }).db, "x")).rejects.toThrow(/boom/);
  });
});
