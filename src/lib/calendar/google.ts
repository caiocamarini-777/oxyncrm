import "server-only";
import { randomUUID } from "node:crypto";
import { loadAccountToken } from "@/lib/gmail/accounts";
import { GmailApiError, GmailNetworkError, type TokenRequest } from "@/lib/gmail/client";
import { buildUrl, googleRequest, type GoogleQuery } from "@/lib/google/http";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const EVENTS_PATH = "/calendars/primary/events";
/** Tamanho de página das listagens (o máximo do Google é 2500; 250 é o padrão). */
const PAGE_SIZE = 250;

type EventTime = { dateTime?: string; date?: string; timeZone?: string };

export type CalendarEvent = {
  id: string;
  etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  eventType?: string;
  start?: EventTime;
  end?: EventTime;
  attendees?: {
    email: string;
    displayName?: string;
    self?: boolean;
    responseStatus?: string;
    organizer?: boolean;
    resource?: boolean;
  }[];
  hangoutLink?: string;
  conferenceData?: {
    conferenceId?: string;
    entryPoints?: { entryPointType?: string; uri?: string }[];
    /** Pedido de criação do link do Meet; só vale no envio (o Google não devolve este campo preenchido). */
    createRequest?: { requestId: string; conferenceSolutionKey: { type: string } };
  };
  recurringEventId?: string;
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
};

type SendUpdates = "all" | "none";
type Page = { items?: CalendarEvent[]; nextPageToken?: string; nextSyncToken?: string };

/** O `syncToken` enviado expirou (o Google respondeu 410): é preciso refazer a carga inicial. */
export class SyncTokenExpiredError extends Error {
  constructor(message = "O token de sincronização da Agenda expirou") {
    super(message);
    this.name = "SyncTokenExpiredError";
  }
}

/**
 * Cliente REST da Agenda do Google (calendário `primary`), no mesmo estilo do `MeetClient`. `getAccessToken` devolve o
 * token vigente; após um 401 é chamado com `forceRefresh` e o token recusado em `rejected`.
 */
export class CalendarClient {
  constructor(private readonly getAccessToken: (opts?: TokenRequest) => Promise<string>) {}

  /** Chamada que sempre devolve um corpo; 204 aqui é resposta incompleta. */
  private async request<T>(url: string, init?: { method?: "GET" | "POST" | "PATCH"; body?: unknown }): Promise<T> {
    const body = await googleRequest<T>(this.getAccessToken, url, init);
    if (body === null) throw new GmailNetworkError("Resposta incompleta do Google");
    return body;
  }

  /** Percorre as páginas de `events.list`; o `nextSyncToken` só vem na última. */
  private async listAll(query: GoogleQuery): Promise<{ events: CalendarEvent[]; nextSyncToken: string | undefined }> {
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const page = await this.request<Page>(
        buildUrl(CALENDAR_BASE, EVENTS_PATH, { ...query, maxResults: PAGE_SIZE, pageToken }),
      );
      events.push(...(page.items ?? []));
      pageToken = page.nextPageToken || undefined;
      nextSyncToken = page.nextSyncToken || undefined;
    } while (pageToken);
    return { events, nextSyncToken };
  }

  /** Mudanças desde o `syncToken` (apagados inclusive). 410 vira `SyncTokenExpiredError`. */
  async listChanges(syncToken: string): Promise<{ events: CalendarEvent[]; nextSyncToken: string }> {
    try {
      const { events, nextSyncToken } = await this.listAll({ syncToken, showDeleted: true, singleEvents: true });
      if (!nextSyncToken) throw new GmailNetworkError("Resposta incompleta do Google");
      return { events, nextSyncToken };
    } catch (e) {
      if (e instanceof GmailApiError && e.status === 410) throw new SyncTokenExpiredError();
      throw e;
    }
  }

  /**
   * Primeira carga: eventos a partir de `timeMin`, apagados inclusive, e o token das próximas rodadas. Sem `orderBy`,
   * porque com ele o Google não devolve o `nextSyncToken`.
   */
  async listFrom(timeMin: Date): Promise<{ events: CalendarEvent[]; nextSyncToken: string }> {
    const { events, nextSyncToken } = await this.listAll({
      timeMin: timeMin.toISOString(),
      showDeleted: true,
      singleEvents: true,
    });
    if (!nextSyncToken) throw new GmailNetworkError("Resposta incompleta do Google");
    return { events, nextSyncToken };
  }

  /** Eventos entre `timeMin` e `timeMax`, com as recorrências já separadas em ocorrências, por início. */
  async listWindow(timeMin: Date, timeMax: Date): Promise<CalendarEvent[]> {
    const { events } = await this.listAll({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });
    return events;
  }

  /**
   * Cria o evento. Com `withMeet`, pede o link do Meet (`conferenceDataVersion=1` e um `createRequest` com `requestId`
   * novo, a não ser que o chamador já tenha mandado o seu).
   */
  insertEvent(
    ev: Partial<CalendarEvent>,
    opts: { sendUpdates: SendUpdates; withMeet: boolean },
  ): Promise<CalendarEvent> {
    const body: Partial<CalendarEvent> =
      opts.withMeet && !ev.conferenceData?.createRequest
        ? {
            ...ev,
            conferenceData: {
              ...ev.conferenceData,
              createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
            },
          }
        : ev;
    return this.request<CalendarEvent>(
      buildUrl(CALENDAR_BASE, EVENTS_PATH, {
        sendUpdates: opts.sendUpdates,
        conferenceDataVersion: opts.withMeet ? 1 : undefined,
      }),
      { method: "POST", body },
    );
  }

  patchEvent(id: string, ev: Partial<CalendarEvent>, opts: { sendUpdates: SendUpdates }): Promise<CalendarEvent> {
    return this.request<CalendarEvent>(
      buildUrl(CALENDAR_BASE, `${EVENTS_PATH}/${encodeURIComponent(id)}`, { sendUpdates: opts.sendUpdates }),
      { method: "PATCH", body: ev },
    );
  }

  /** Apaga o evento. 404 e 410 (já apagado) não são erro. */
  async deleteEvent(id: string, opts: { sendUpdates: SendUpdates }): Promise<void> {
    try {
      await googleRequest<null>(
        this.getAccessToken,
        buildUrl(CALENDAR_BASE, `${EVENTS_PATH}/${encodeURIComponent(id)}`, { sendUpdates: opts.sendUpdates }),
        { method: "DELETE" },
      );
    } catch (e) {
      if (e instanceof GmailApiError && (e.status === 404 || e.status === 410)) return;
      throw e;
    }
  }
}

/** Cliente da Agenda com o token da caixa do Gmail (renovado a cada 401). */
export function calendarClientForAccount(accountId: string): CalendarClient {
  return new CalendarClient((opts) => loadAccountToken(accountId, { forceRefresh: opts?.forceRefresh }));
}
