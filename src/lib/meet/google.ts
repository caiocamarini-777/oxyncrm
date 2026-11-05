import "server-only";
import { loadAccountToken } from "@/lib/gmail/accounts";
import {
  GmailApiError,
  GmailAuthError,
  GmailNetworkError,
  GmailRateLimitError,
  type TokenRequest,
} from "@/lib/gmail/client";

const MEET_BASE = "https://meet.googleapis.com/v2";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

/** Janela de busca do evento da agenda ao redor do horário da reunião. */
const EVENT_WINDOW_MS = 12 * 3600_000;

export type ConferenceRecord = { name: string; space: string; startTime: string; endTime: string | null };
export type Transcript = { name: string; state: "STARTED" | "ENDED" | "FILE_GENERATED" | string };
export type TranscriptEntry = { participant: string; text: string; startTime: string };
export type Participant = {
  name: string;
  signedinUser?: { user: string; displayName: string };
  anonymousUser?: { displayName: string };
};
export type CalendarEvent = {
  id: string;
  summary?: string;
  organizer?: { email: string };
  attendees?: { email: string; displayName?: string; self?: boolean; resource?: boolean }[];
  conferenceData?: { conferenceId?: string };
};

type Query = Record<string, string | number | boolean | undefined>;

type ApiErrorBody = { error?: { code?: number; message?: string; status?: string; errors?: { reason?: string }[] } };

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** `fetch` que transforma falha de rede (o `fetch` lança `TypeError`) em `GmailNetworkError`, como no cliente do Gmail. */
async function http(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof TypeError) throw new GmailNetworkError(e.message || undefined);
    throw e;
  }
}

function buildUrl(base: string, path: string, query?: Query): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === "") continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/** Codifica cada segmento de um nome de recurso do Google (ex.: `conferenceRecords/abc/transcripts/x`). */
function resourcePath(name: string): string {
  return `/${name.split("/").map(encodeURIComponent).join("/")}`;
}

function isRateLimit(status: number, body: ApiErrorBody | null): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const reasons = body?.error?.errors?.map((e) => e.reason) ?? [];
  return (
    reasons.includes("rateLimitExceeded") ||
    reasons.includes("userRateLimitExceeded") ||
    body?.error?.status === "RESOURCE_EXHAUSTED"
  );
}

/**
 * Cliente REST do Google Meet e da Agenda (mesmo estilo do `GmailClient`). `getAccessToken` devolve o token
 * vigente; após um 401 é chamado com `forceRefresh` e o token recusado em `rejected`.
 */
export class MeetClient {
  constructor(private readonly getAccessToken: (opts?: TokenRequest) => Promise<string>) {}

  private async request<T>(url: string): Promise<T> {
    let token = await this.getAccessToken();
    for (let attempt = 0; ; attempt++) {
      const res = await http(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        // 2xx sem JSON legível (resposta cortada no meio): rede, não erro do recurso.
        const body = await readJson<T>(res);
        if (body === null) throw new GmailNetworkError("Resposta incompleta do Google");
        return body;
      }
      if (res.status === 401) {
        if (attempt === 0) {
          token = await this.getAccessToken({ forceRefresh: true, rejected: token });
          continue;
        }
        throw new GmailAuthError("O Google recusou o token renovado");
      }
      const body = await readJson<ApiErrorBody>(res);
      if (isRateLimit(res.status, body)) throw new GmailRateLimitError(body?.error?.message);
      throw new GmailApiError(res.status, body?.error?.message ?? `O Google respondeu ${res.status}`);
    }
  }

  /** Percorre todas as páginas de uma listagem, juntando o campo `field` de cada uma. */
  private async listAll<T>(base: string, path: string, field: string, query: Query): Promise<T[]> {
    const out: T[] = [];
    let pageToken: string | undefined;
    do {
      const r = await this.request<Record<string, unknown> & { nextPageToken?: string }>(
        buildUrl(base, path, { ...query, pageToken }),
      );
      out.push(...((r[field] as T[] | undefined) ?? []));
      pageToken = r.nextPageToken || undefined;
    } while (pageToken);
    return out;
  }

  /** Reuniões que terminaram a partir de `endAfter` (as ainda em andamento não têm `end_time` e ficam de fora). */
  async listConferenceRecords(endAfter: Date): Promise<ConferenceRecord[]> {
    const records = await this.listAll<Omit<ConferenceRecord, "endTime"> & { endTime?: string }>(
      MEET_BASE,
      "/conferenceRecords",
      "conferenceRecords",
      { filter: `end_time>="${endAfter.toISOString()}"` },
    );
    return records.map((r) => ({ ...r, endTime: r.endTime ?? null }));
  }

  /** Código da reunião (ex.: `abc-defg-hij`) de um espaço (`spaces/xyz`). */
  async getMeetingCode(space: string): Promise<string | null> {
    const r = await this.request<{ meetingCode?: string }>(buildUrl(MEET_BASE, resourcePath(space)));
    return r.meetingCode || null;
  }

  listTranscripts(record: string): Promise<Transcript[]> {
    return this.listAll(MEET_BASE, `${resourcePath(record)}/transcripts`, "transcripts", {});
  }

  listTranscriptEntries(transcript: string): Promise<TranscriptEntry[]> {
    return this.listAll(MEET_BASE, `${resourcePath(transcript)}/entries`, "transcriptEntries", { pageSize: 100 });
  }

  listParticipants(record: string): Promise<Participant[]> {
    return this.listAll(MEET_BASE, `${resourcePath(record)}/participants`, "participants", {});
  }

  /** Evento da agenda principal, em até 12 h de `around`, cujo `conferenceId` é o código da reunião. */
  async findEventByMeetingCode(code: string, around: Date): Promise<CalendarEvent | null> {
    const events = await this.listAll<CalendarEvent>(CALENDAR_BASE, "/calendars/primary/events", "items", {
      timeMin: new Date(around.getTime() - EVENT_WINDOW_MS).toISOString(),
      timeMax: new Date(around.getTime() + EVENT_WINDOW_MS).toISOString(),
      singleEvents: true,
    });
    return events.find((e) => e.conferenceData?.conferenceId === code) ?? null;
  }
}

/** Cliente do Meet e da Agenda com o token da caixa do Gmail (renovado a cada 401). */
export function meetClientForAccount(accountId: string): MeetClient {
  return new MeetClient((opts) => loadAccountToken(accountId, { forceRefresh: opts?.forceRefresh }));
}
