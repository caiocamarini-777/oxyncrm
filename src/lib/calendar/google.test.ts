import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const loadAccountToken = vi.fn<(id: string, opts?: { forceRefresh?: boolean }) => Promise<string>>(async () => "tok-conta");
vi.mock("@/lib/gmail/accounts", () => ({
  loadAccountToken: (id: string, opts?: { forceRefresh?: boolean }) => loadAccountToken(id, opts),
}));

import { GmailApiError, GmailAuthError, GmailNetworkError, GmailRateLimitError } from "@/lib/gmail/client";
import { CalendarClient, SyncTokenExpiredError, calendarClientForAccount } from "./google";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  loadAccountToken.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const urlOf = (call: number) => new URL(fetchMock.mock.calls[call][0] as string);
const initOf = (call: number) => fetchMock.mock.calls[call][1] as RequestInit;
const headersOf = (call: number) => initOf(call).headers as Record<string, string>;
const bodyOf = (call: number) => JSON.parse(initOf(call).body as string);
const client = (getToken = vi.fn(async () => "tok")) => ({ getToken, cal: new CalendarClient(getToken) });

const CAL_EVENTS = "/calendar/v3/calendars/primary/events";

describe("CalendarClient.listChanges", () => {
  it("pagina por nextPageToken e devolve o nextSyncToken da última página", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { items: [{ id: "a" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json(200, { items: [{ id: "b", status: "cancelled" }], nextSyncToken: "S2" }));
    const r = await client().cal.listChanges("S1");
    expect(r.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(r.nextSyncToken).toBe("S2");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(urlOf(0).origin + urlOf(0).pathname).toBe(`https://www.googleapis.com${CAL_EVENTS}`);
    expect(initOf(0).method).toBe("GET");
    expect(urlOf(0).searchParams.get("syncToken")).toBe("S1");
    expect(urlOf(0).searchParams.get("showDeleted")).toBe("true");
    expect(urlOf(0).searchParams.get("singleEvents")).toBe("true");
    expect(urlOf(0).searchParams.get("maxResults")).toBe("250");
    expect(urlOf(0).searchParams.get("pageToken")).toBeNull();
    // Com syncToken o Google recusa timeMin, timeMax e orderBy.
    for (const p of ["timeMin", "timeMax", "orderBy"]) expect(urlOf(0).searchParams.get(p)).toBeNull();

    expect(urlOf(1).searchParams.get("syncToken")).toBe("S1");
    expect(urlOf(1).searchParams.get("pageToken")).toBe("p2");
    expect(headersOf(0).Authorization).toBe("Bearer tok");
  });

  it("410 vira SyncTokenExpiredError", async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: { code: 410, message: "Sync token is no longer valid" } }));
    await expect(client().cal.listChanges("velho")).rejects.toBeInstanceOf(SyncTokenExpiredError);
  });

  it("410 numa página do meio também vira SyncTokenExpiredError", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { items: [{ id: "a" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json(410, { error: { message: "gone" } }));
    await expect(client().cal.listChanges("S1")).rejects.toBeInstanceOf(SyncTokenExpiredError);
  });

  it("aceita lista ausente como vazia", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { nextSyncToken: "S2" }));
    expect(await client().cal.listChanges("S1")).toEqual({ events: [], nextSyncToken: "S2" });
  });

  it("sem nextSyncToken na última página é resposta incompleta", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { items: [] }));
    await expect(client().cal.listChanges("S1")).rejects.toBeInstanceOf(GmailNetworkError);
  });

  it("outros erros seguem como GmailApiError", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: { message: "boom" } }));
    const e = await client().cal.listChanges("S1").catch((x) => x);
    expect(e).toBeInstanceOf(GmailApiError);
    expect(e).not.toBeInstanceOf(SyncTokenExpiredError);
    expect(e.status).toBe(500);
  });
});

describe("CalendarClient.listFrom", () => {
  it("envia timeMin em ISO, showDeleted e singleEvents, sem orderBy, e devolve o nextSyncToken", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { items: [{ id: "a" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json(200, { items: [{ id: "b" }], nextSyncToken: "S9" }));
    const r = await client().cal.listFrom(new Date("2026-11-01T03:00:00Z"));
    expect(r.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(r.nextSyncToken).toBe("S9");

    expect(urlOf(0).pathname).toBe(CAL_EVENTS);
    expect(urlOf(0).searchParams.get("timeMin")).toBe("2026-11-01T03:00:00.000Z");
    expect(urlOf(0).searchParams.get("showDeleted")).toBe("true");
    expect(urlOf(0).searchParams.get("singleEvents")).toBe("true");
    expect(urlOf(0).searchParams.get("maxResults")).toBe("250");
    expect(urlOf(0).searchParams.get("syncToken")).toBeNull();
    // orderBy impediria o Google de devolver o nextSyncToken.
    expect(urlOf(0).searchParams.get("orderBy")).toBeNull();
    expect(urlOf(1).searchParams.get("pageToken")).toBe("p2");
    expect(urlOf(1).searchParams.get("timeMin")).toBe("2026-11-01T03:00:00.000Z");
  });

  it("sem nextSyncToken na última página é resposta incompleta", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { items: [{ id: "a" }] }));
    await expect(client().cal.listFrom(new Date())).rejects.toBeInstanceOf(GmailNetworkError);
  });
});

describe("CalendarClient.listWindow", () => {
  it("envia a janela com singleEvents e orderBy=startTime e pagina", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { items: [{ id: "a" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json(200, { items: [{ id: "b" }] }));
    const r = await client().cal.listWindow(new Date("2026-11-09T00:00:00Z"), new Date("2026-11-16T00:00:00Z"));
    expect(r.map((e) => e.id)).toEqual(["a", "b"]);
    expect(urlOf(0).pathname).toBe(CAL_EVENTS);
    expect(urlOf(0).searchParams.get("timeMin")).toBe("2026-11-09T00:00:00.000Z");
    expect(urlOf(0).searchParams.get("timeMax")).toBe("2026-11-16T00:00:00.000Z");
    expect(urlOf(0).searchParams.get("singleEvents")).toBe("true");
    expect(urlOf(0).searchParams.get("orderBy")).toBe("startTime");
    expect(urlOf(0).searchParams.get("maxResults")).toBe("250");
    expect(urlOf(0).searchParams.get("syncToken")).toBeNull();
    expect(urlOf(1).searchParams.get("pageToken")).toBe("p2");
  });
});

describe("CalendarClient.insertEvent", () => {
  it("com withMeet envia conferenceDataVersion=1, sendUpdates=all e o corpo em JSON com o pedido de Meet", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "novo", hangoutLink: "https://meet.google.com/abc-defg-hij" }));
    const ev = {
      summary: "Reunião",
      start: { dateTime: "2026-11-10T14:00:00-03:00", timeZone: "America/Sao_Paulo" },
      attendees: [{ email: "cliente@x.com" }],
    };
    const r = await client().cal.insertEvent(ev, { sendUpdates: "all", withMeet: true });
    expect(r).toEqual({ id: "novo", hangoutLink: "https://meet.google.com/abc-defg-hij" });

    expect(initOf(0).method).toBe("POST");
    expect(urlOf(0).pathname).toBe(CAL_EVENTS);
    expect(urlOf(0).searchParams.get("sendUpdates")).toBe("all");
    expect(urlOf(0).searchParams.get("conferenceDataVersion")).toBe("1");
    expect(headersOf(0)["Content-Type"]).toBe("application/json");
    const body = bodyOf(0);
    expect(body.summary).toBe("Reunião");
    expect(body.attendees).toEqual([{ email: "cliente@x.com" }]);
    expect(body.conferenceData.createRequest.conferenceSolutionKey).toEqual({ type: "hangoutsMeet" });
    expect(body.conferenceData.createRequest.requestId).toMatch(/^[0-9a-f-]{36}$/);
    // O objeto do chamador não é alterado.
    expect(ev).not.toHaveProperty("conferenceData");
  });

  it("cada chamada com withMeet usa um requestId novo", async () => {
    // Uma resposta nova por chamada: o corpo de um Response só pode ser lido uma vez.
    fetchMock.mockImplementation(async () => json(200, { id: "x" }));
    const { cal } = client();
    await cal.insertEvent({ summary: "a" }, { sendUpdates: "none", withMeet: true });
    await cal.insertEvent({ summary: "a" }, { sendUpdates: "none", withMeet: true });
    expect(bodyOf(0).conferenceData.createRequest.requestId).not.toBe(bodyOf(1).conferenceData.createRequest.requestId);
  });

  it("respeita o createRequest que o chamador já mandou", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "x" }));
    const conferenceData = { createRequest: { requestId: "meu-id", conferenceSolutionKey: { type: "hangoutsMeet" } } };
    await client().cal.insertEvent({ summary: "a", conferenceData }, { sendUpdates: "all", withMeet: true });
    expect(bodyOf(0).conferenceData).toEqual(conferenceData);
  });

  it("sem withMeet não envia conferenceDataVersion nem conferenceData", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "x" }));
    await client().cal.insertEvent({ summary: "Tarefa" }, { sendUpdates: "none", withMeet: false });
    expect(urlOf(0).searchParams.get("sendUpdates")).toBe("none");
    expect(urlOf(0).searchParams.get("conferenceDataVersion")).toBeNull();
    expect(bodyOf(0)).toEqual({ summary: "Tarefa" });
  });

  it("resposta 2xx sem JSON legível vira GmailNetworkError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{cortado", { status: 200 }));
    await expect(client().cal.insertEvent({ summary: "a" }, { sendUpdates: "none", withMeet: false })).rejects.toBeInstanceOf(
      GmailNetworkError,
    );
  });
});

describe("CalendarClient.patchEvent", () => {
  it("usa PATCH em /calendars/primary/events/{id} com sendUpdates e o corpo em JSON", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: "ev/1", etag: '"e2"' }));
    const r = await client().cal.patchEvent("ev/1", { summary: "Novo título" }, { sendUpdates: "none" });
    expect(r).toEqual({ id: "ev/1", etag: '"e2"' });
    expect(initOf(0).method).toBe("PATCH");
    expect(urlOf(0).pathname).toBe(`${CAL_EVENTS}/ev%2F1`);
    expect(urlOf(0).searchParams.get("sendUpdates")).toBe("none");
    expect(urlOf(0).searchParams.get("conferenceDataVersion")).toBeNull();
    expect(headersOf(0)["Content-Type"]).toBe("application/json");
    expect(bodyOf(0)).toEqual({ summary: "Novo título" });
  });
});

describe("CalendarClient.deleteEvent", () => {
  it("usa DELETE em /calendars/primary/events/{id} com sendUpdates, sem corpo", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(client().cal.deleteEvent("abc", { sendUpdates: "all" })).resolves.toBeUndefined();
    expect(initOf(0).method).toBe("DELETE");
    expect(urlOf(0).pathname).toBe(`${CAL_EVENTS}/abc`);
    expect(urlOf(0).searchParams.get("sendUpdates")).toBe("all");
    expect(initOf(0).body).toBeUndefined();
  });

  it("404 e 410 não lançam (já estava apagado)", async () => {
    fetchMock
      .mockResolvedValueOnce(json(404, { error: { message: "Not Found" } }))
      .mockResolvedValueOnce(json(410, { error: { message: "Resource has been deleted" } }));
    const { cal } = client();
    await expect(cal.deleteEvent("a", { sendUpdates: "none" })).resolves.toBeUndefined();
    await expect(cal.deleteEvent("b", { sendUpdates: "none" })).resolves.toBeUndefined();
  });

  it("outros erros continuam lançando", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: { message: "boom" } }));
    const e = await client().cal.deleteEvent("a", { sendUpdates: "none" }).catch((x) => x);
    expect(e).toBeInstanceOf(GmailApiError);
    expect(e.status).toBe(500);
  });
});

describe("renovação do token e erros", () => {
  it("401 renova o token uma vez e reenvia o mesmo corpo", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { message: "expirou" } }))
      .mockResolvedValueOnce(json(200, { id: "x" }));
    const getToken = vi.fn(async (o?: { forceRefresh?: boolean; rejected?: string }) => (o?.forceRefresh ? "novo" : "velho"));
    const r = await new CalendarClient(getToken).patchEvent("x", { summary: "s" }, { sendUpdates: "none" });
    expect(r).toEqual({ id: "x" });
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenLastCalledWith({ forceRefresh: true, rejected: "velho" });
    expect(headersOf(0).Authorization).toBe("Bearer velho");
    expect(headersOf(1).Authorization).toBe("Bearer novo");
    expect(bodyOf(1)).toEqual({ summary: "s" });
    expect(initOf(1).method).toBe("PATCH");
  });

  it("segundo 401 lança GmailAuthError", async () => {
    fetchMock.mockResolvedValue(json(401, {}));
    await expect(client().cal.listFrom(new Date())).rejects.toBeInstanceOf(GmailAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 lança GmailRateLimitError", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: { message: "devagar" } }));
    await expect(client().cal.listChanges("S1")).rejects.toBeInstanceOf(GmailRateLimitError);
  });

  it("403 com rateLimitExceeded também é limite de uso", async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }));
    await expect(client().cal.insertEvent({ summary: "a" }, { sendUpdates: "none", withMeet: false })).rejects.toBeInstanceOf(
      GmailRateLimitError,
    );
  });

  it("falha de rede vira GmailNetworkError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(client().cal.deleteEvent("a", { sendUpdates: "none" })).rejects.toBeInstanceOf(GmailNetworkError);
  });
});

describe("calendarClientForAccount", () => {
  it("usa o token da caixa e renova no 401 com forceRefresh", async () => {
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(200, { items: [], nextSyncToken: "S" }));
    const cal = calendarClientForAccount("acc-1");
    await cal.listFrom(new Date("2026-11-01T00:00:00Z"));
    expect(loadAccountToken).toHaveBeenNthCalledWith(1, "acc-1", { forceRefresh: undefined });
    expect(loadAccountToken).toHaveBeenNthCalledWith(2, "acc-1", { forceRefresh: true });
    expect(headersOf(0).Authorization).toBe("Bearer tok-conta");
  });
});
