import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GmailApiError, GmailAuthError, GmailNetworkError, GmailRateLimitError } from "@/lib/gmail/client";
import { MeetClient } from "./google";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const urlOf = (call: number) => new URL(fetchMock.mock.calls[call][0] as string);
const initOf = (call: number) => fetchMock.mock.calls[call][1] as RequestInit;
const client = (getToken = vi.fn(async () => "tok")) => ({ getToken, meet: new MeetClient(getToken) });

describe("MeetClient.listConferenceRecords", () => {
  it("pagina e envia o filtro de end_time", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, {
          conferenceRecords: [{ name: "conferenceRecords/a", space: "spaces/s1", startTime: "2026-11-05T10:00:00Z", endTime: "2026-11-05T11:00:00Z" }],
          nextPageToken: "p2",
        }),
      )
      .mockResolvedValueOnce(
        json(200, { conferenceRecords: [{ name: "conferenceRecords/b", space: "spaces/s2", startTime: "2026-11-05T12:00:00Z" }] }),
      );
    const { meet } = client();
    const r = await meet.listConferenceRecords(new Date("2026-11-05T00:00:00Z"));
    expect(r.map((x) => x.name)).toEqual(["conferenceRecords/a", "conferenceRecords/b"]);
    expect(r[1].endTime).toBeNull();
    expect(urlOf(0).origin + urlOf(0).pathname).toBe("https://meet.googleapis.com/v2/conferenceRecords");
    expect(urlOf(0).searchParams.get("filter")).toBe('end_time>="2026-11-05T00:00:00.000Z"');
    expect(urlOf(0).searchParams.get("pageToken")).toBeNull();
    expect(urlOf(1).searchParams.get("pageToken")).toBe("p2");
    expect((initOf(0).headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("aceita lista ausente como vazia", async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    expect(await client().meet.listConferenceRecords(new Date())).toEqual([]);
  });
});

describe("renovação do token", () => {
  it("401 seguido de sucesso renova o token uma vez", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { message: "expirou" } }))
      .mockResolvedValueOnce(json(200, { transcripts: [{ name: "t1", state: "ENDED" }] }));
    const getToken = vi.fn(async (o?: { forceRefresh?: boolean; rejected?: string }) => (o?.forceRefresh ? "novo" : "velho"));
    const r = await new MeetClient(getToken).listTranscripts("conferenceRecords/a");
    expect(r).toEqual([{ name: "t1", state: "ENDED" }]);
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenLastCalledWith({ forceRefresh: true, rejected: "velho" });
    expect((initOf(1).headers as Record<string, string>).Authorization).toBe("Bearer novo");
  });

  it("segundo 401 lança GmailAuthError", async () => {
    fetchMock.mockResolvedValue(json(401, {}));
    await expect(client().meet.listTranscripts("conferenceRecords/a")).rejects.toBeInstanceOf(GmailAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("erros", () => {
  it("429 lança GmailRateLimitError", async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: { message: "devagar" } }));
    await expect(client().meet.listParticipants("conferenceRecords/a")).rejects.toBeInstanceOf(GmailRateLimitError);
  });

  it("403 com rateLimitExceeded também é limite de uso", async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }));
    await expect(client().meet.listParticipants("conferenceRecords/a")).rejects.toBeInstanceOf(GmailRateLimitError);
  });

  it("outros erros viram GmailApiError com o status", async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: { message: "boom" } }));
    const e = await client().meet.listParticipants("conferenceRecords/a").catch((x) => x);
    expect(e).toBeInstanceOf(GmailApiError);
    expect(e.status).toBe(500);
  });

  it("falha de rede vira GmailNetworkError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(client().meet.getMeetingCode("spaces/s1")).rejects.toBeInstanceOf(GmailNetworkError);
  });

  it("2xx sem JSON legível vira GmailNetworkError", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{cortado", { status: 200 }));
    await expect(client().meet.getMeetingCode("spaces/s1")).rejects.toBeInstanceOf(GmailNetworkError);
  });
});

describe("demais chamadas do Meet", () => {
  it("getMeetingCode lê meetingCode do espaço (e devolve null sem ele)", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { name: "spaces/s1", meetingCode: "abc-defg-hij" })).mockResolvedValueOnce(json(200, {}));
    const { meet } = client();
    expect(await meet.getMeetingCode("spaces/s1")).toBe("abc-defg-hij");
    expect(urlOf(0).href).toBe("https://meet.googleapis.com/v2/spaces/s1");
    expect(await meet.getMeetingCode("spaces/s2")).toBeNull();
  });

  it("listTranscripts usa o caminho do registro", async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));
    expect(await client().meet.listTranscripts("conferenceRecords/a")).toEqual([]);
    expect(urlOf(0).pathname).toBe("/v2/conferenceRecords/a/transcripts");
  });

  it("listTranscriptEntries pagina com pageSize=100", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, { transcriptEntries: [{ participant: "p/1", text: "oi", startTime: "2026-11-05T10:00:01Z" }], nextPageToken: "n2" }),
      )
      .mockResolvedValueOnce(json(200, { transcriptEntries: [{ participant: "p/2", text: "olá", startTime: "2026-11-05T10:00:05Z" }] }));
    const r = await client().meet.listTranscriptEntries("conferenceRecords/a/transcripts/t1");
    expect(r.map((e) => e.text)).toEqual(["oi", "olá"]);
    expect(urlOf(0).pathname).toBe("/v2/conferenceRecords/a/transcripts/t1/entries");
    expect(urlOf(0).searchParams.get("pageSize")).toBe("100");
    expect(urlOf(1).searchParams.get("pageToken")).toBe("n2");
  });

  it("listParticipants devolve os participantes", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, { participants: [{ name: "conferenceRecords/a/participants/1", signedinUser: { user: "users/9", displayName: "Ana" } }] }),
    );
    const r = await client().meet.listParticipants("conferenceRecords/a");
    expect(r[0].signedinUser?.displayName).toBe("Ana");
    expect(urlOf(0).pathname).toBe("/v2/conferenceRecords/a/participants");
  });
});

describe("MeetClient.findEventByMeetingCode", () => {
  const around = new Date("2026-11-05T12:00:00Z");

  it("consulta ±12h com singleEvents e devolve o evento com o mesmo conferenceId", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        items: [
          { id: "e1", summary: "Outro", conferenceData: { conferenceId: "zzz-zzzz-zzz" } },
          { id: "e2" },
          { id: "e3", summary: "Alvo", conferenceData: { conferenceId: "abc-defg-hij" } },
        ],
      }),
    );
    const ev = await client().meet.findEventByMeetingCode("abc-defg-hij", around);
    expect(ev?.id).toBe("e3");
    const u = urlOf(0);
    expect(u.origin + u.pathname).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    expect(u.searchParams.get("timeMin")).toBe("2026-11-05T00:00:00.000Z");
    expect(u.searchParams.get("timeMax")).toBe("2026-11-06T00:00:00.000Z");
    expect(u.searchParams.get("singleEvents")).toBe("true");
  });

  it("segue a paginação até achar", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { items: [{ id: "e1" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(json(200, { items: [{ id: "e2", conferenceData: { conferenceId: "abc-defg-hij" } }] }));
    expect((await client().meet.findEventByMeetingCode("abc-defg-hij", around))?.id).toBe("e2");
    expect(urlOf(1).searchParams.get("pageToken")).toBe("p2");
  });

  it("com vários eventos do mesmo código (reunião recorrente), escolhe o de início mais perto de around", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        items: [
          { id: "ontem", conferenceData: { conferenceId: "abc-defg-hij" }, start: { dateTime: "2026-11-04T13:00:00Z" } },
          { id: "sem-inicio", conferenceData: { conferenceId: "abc-defg-hij" } },
          { id: "hoje", conferenceData: { conferenceId: "abc-defg-hij" }, start: { dateTime: "2026-11-05T09:00:00-03:00" } },
          { id: "amanha", conferenceData: { conferenceId: "abc-defg-hij" }, start: { dateTime: "2026-11-05T22:00:00Z" } },
          { id: "outro", conferenceData: { conferenceId: "zzz-zzzz-zzz" }, start: { dateTime: "2026-11-05T12:00:00Z" } },
        ],
      }),
    );
    expect((await client().meet.findEventByMeetingCode("abc-defg-hij", around))?.id).toBe("hoje");
  });

  it("evento de dia inteiro conta pelo início do dia; sem início, fica atrás dos que têm", async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        items: [
          { id: "sem-inicio", conferenceData: { conferenceId: "abc-defg-hij" } },
          { id: "dia", conferenceData: { conferenceId: "abc-defg-hij" }, start: { date: "2026-11-05" } },
        ],
      }),
    );
    expect((await client().meet.findEventByMeetingCode("abc-defg-hij", around))?.id).toBe("dia");
  });

  it("devolve null quando nenhum evento bate (ou não há itens)", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { items: [{ id: "e1", conferenceData: { conferenceId: "outro" } }] }))
      .mockResolvedValueOnce(json(200, {}));
    const { meet } = client();
    expect(await meet.findEventByMeetingCode("abc-defg-hij", around)).toBeNull();
    expect(await meet.findEventByMeetingCode("abc-defg-hij", around)).toBeNull();
  });
});

describe("MeetClient.getConferenceRecord", () => {
  it("lê a reunião pelo nome, com endTime nulo quando ainda não terminou", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(200, { name: "conferenceRecords/a", space: "spaces/s1", startTime: "2026-11-05T10:00:00Z", endTime: "2026-11-05T11:00:00Z" }),
      )
      .mockResolvedValueOnce(json(200, { name: "conferenceRecords/b", space: "spaces/s2", startTime: "2026-11-05T12:00:00Z" }));
    const { meet } = client();
    expect(await meet.getConferenceRecord("conferenceRecords/a")).toEqual({
      name: "conferenceRecords/a",
      space: "spaces/s1",
      startTime: "2026-11-05T10:00:00Z",
      endTime: "2026-11-05T11:00:00Z",
    });
    expect(urlOf(0).origin + urlOf(0).pathname).toBe("https://meet.googleapis.com/v2/conferenceRecords/a");
    expect((await meet.getConferenceRecord("conferenceRecords/b")).endTime).toBeNull();
  });

  it("404 vira GmailApiError (erro permanente para quem chama)", async () => {
    fetchMock.mockResolvedValueOnce(json(404, { error: { message: "Requested entity was not found." } }));
    await expect(client().meet.getConferenceRecord("conferenceRecords/x")).rejects.toMatchObject({ status: 404 });
  });
});
