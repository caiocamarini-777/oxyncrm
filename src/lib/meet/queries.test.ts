import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { TimelineItem } from "@/lib/timeline/queries";
import { hideMeetingNotes, toRecordMeeting } from "./queries";

const note = (id: string, externalId?: string): TimelineItem => ({
  kind: "note",
  at: "2026-11-05T15:00:00Z",
  actorName: "Caio",
  text: "",
  note: { id, body: `corpo ${id}`, canEdit: true },
  ...(externalId ? { externalId } : {}),
});

const event = (kind: string): TimelineItem => ({ kind, at: "2026-11-05T14:00:00Z", actorName: "Sistema", text: kind });

describe("hideMeetingNotes", () => {
  it("remove só as anotações importadas cujo id do Pipedrive está no conjunto", () => {
    const items = [note("n1", "101"), note("n2", "102"), note("n3", "103")];
    const out = hideMeetingNotes(items, new Set(["101", "103"]));
    expect(out.map((i) => i.note?.id)).toEqual(["n2"]);
  });

  it("mantém anotações sem id do Pipedrive (criadas no CRM) e os eventos", () => {
    const items = [event("created"), note("n1"), note("n2", "101"), event("stage_changed")];
    const out = hideMeetingNotes(items, new Set(["101"]));
    expect(out.map((i) => i.note?.id ?? i.kind)).toEqual(["created", "n1", "stage_changed"]);
  });

  it("não esconde evento só porque o id coincide: apenas anotações", () => {
    const weird: TimelineItem = { ...event("created"), externalId: "101" };
    expect(hideMeetingNotes([weird], new Set(["101"]))).toEqual([weird]);
  });

  it("conjunto vazio devolve tudo, e a lista de entrada não é alterada", () => {
    const items = [note("n1", "101"), event("created")];
    expect(hideMeetingNotes(items, new Set())).toEqual(items);
    hideMeetingNotes(items, new Set(["101"]));
    expect(items).toHaveLength(2);
  });
});

describe("toRecordMeeting", () => {
  const base = {
    id: "m1",
    title: "Reunião com a Ana",
    started_at: "2026-11-05T17:00:00Z",
    ended_at: "2026-11-05T17:45:00Z",
    created_at: "2026-11-05T18:10:00Z",
    status: "done",
    meeting_notes: {
      summary: "Resumo da conversa",
      pains: ["Planilha manual"],
      objections: [],
      qualification: [{ question: "Orçamento", answer: "R$ 5 mil" }],
      next_steps: [{ what: "Enviar proposta", owner: "Caio", due: "2026-11-10" }],
    },
    meeting_suggestions: [
      { id: "s2", kind: "stage", payload: { stage: "Proposta" }, status: "pending", last_error: null },
      { id: "s1", kind: "meeting_outcome", payload: { outcome: "Realizada" }, status: "confirmed", last_error: null },
    ],
    meeting_transcripts: { meeting_id: "m1" },
  };

  it("monta a reunião com notas, sugestões em ordem fixa e a marca de transcrição", () => {
    const m = toRecordMeeting(base, true);
    expect(m).toMatchObject({
      id: "m1",
      title: "Reunião com a Ana",
      startedAt: "2026-11-05T17:00:00Z",
      status: "done",
      hasTranscript: true,
      canEdit: true,
    });
    expect(m?.notes).toEqual(base.meeting_notes);
    expect(m?.suggestions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(m?.suggestions[0]).toEqual({
      id: "s1",
      kind: "meeting_outcome",
      payload: { outcome: "Realizada" },
      status: "confirmed",
      lastError: null,
    });
  });

  it("aceita as relações como lista (um elemento) e sem transcrição", () => {
    const m = toRecordMeeting({ ...base, meeting_notes: [base.meeting_notes], meeting_transcripts: [] }, false);
    expect(m?.notes?.summary).toBe("Resumo da conversa");
    expect(m?.hasTranscript).toBe(false);
    expect(m?.canEdit).toBe(false);
  });

  it("processando e sem notas: notes nulo", () => {
    const m = toRecordMeeting({ ...base, status: "processing", meeting_notes: null, meeting_suggestions: [] }, true);
    expect(m?.status).toBe("processing");
    expect(m?.notes).toBeNull();
    expect(m?.suggestions).toEqual([]);
  });

  it("sem início usa o fim e depois a criação", () => {
    expect(toRecordMeeting({ ...base, started_at: null }, true)?.startedAt).toBe("2026-11-05T17:45:00Z");
    expect(toRecordMeeting({ ...base, started_at: null, ended_at: null }, true)?.startedAt).toBe("2026-11-05T18:10:00Z");
  });

  it("tolera JSON fora do formato nas notas e descarta o que não serve", () => {
    const m = toRecordMeeting(
      {
        ...base,
        meeting_notes: {
          summary: 42,
          pains: ["ok", 7, null],
          objections: "texto",
          qualification: [{ question: "A", answer: "B" }, { question: "sem resposta" }, "x"],
          next_steps: [{ what: "Ligar", owner: null, due: 5 }, { owner: "sem o quê" }],
        },
      },
      true,
    );
    expect(m?.notes).toEqual({
      summary: "",
      pains: ["ok"],
      objections: [],
      qualification: [{ question: "A", answer: "B" }],
      next_steps: [{ what: "Ligar", owner: "", due: null }],
    });
  });

  it("ignora status e sugestões desconhecidos", () => {
    expect(toRecordMeeting({ ...base, status: "ignored" }, true)).toBeNull();
    const m = toRecordMeeting(
      {
        ...base,
        meeting_suggestions: [
          { id: "x", kind: "outra", payload: {}, status: "pending", last_error: null },
          { id: "y", kind: "stage", payload: { stage: "A" }, status: "estranho", last_error: null },
          { id: "z", kind: "stage", payload: { stage: "A" }, status: "failed", last_error: "Pipedrive fora do ar" },
        ],
      },
      true,
    );
    expect(m?.suggestions.map((s) => s.id)).toEqual(["z"]);
    expect(m?.suggestions[0].lastError).toBe("Pipedrive fora do ar");
  });
});
