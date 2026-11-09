import { describe, expect, it } from "vitest";
import type { RecordThread, ThreadMessageView } from "@/lib/gmail/thread-view";
import {
  buildPipedriveThreads,
  dropImportedDuplicates,
  formatFileSize,
  toRecordFileView,
  type PipedriveAttachmentRow,
  type PipedriveEmailRow,
} from "./view";

const email = (over: Partial<PipedriveEmailRow>): PipedriveEmailRow => ({
  id: "e",
  pipedrive_thread_id: null,
  subject: "Proposta",
  from_email: "ana@cliente.com",
  from_name: "Ana",
  to: [{ email: "caio@oxyn.com", name: "Caio" }],
  cc: [],
  sent_at: "2026-01-01T10:00:00.000Z",
  snippet: "Oi",
  rfc_message_id: null,
  direction: "in",
  ...over,
});

const linkIdFor = (emailId: string) => `link-${emailId}`;

describe("buildPipedriveThreads", () => {
  const rows = [
    email({ id: "e1", pipedrive_thread_id: 10, sent_at: "2026-01-01T10:00:00.000Z" }),
    email({ id: "e2", pipedrive_thread_id: 20, subject: "Outra", sent_at: "2026-02-01T10:00:00.000Z" }),
    email({ id: "e3", pipedrive_thread_id: 10, subject: "Re: Proposta", sent_at: "2026-01-03T10:00:00.000Z", direction: "out" }),
    email({ id: "e4", sent_at: "2026-03-01T10:00:00.000Z" }),
    email({ id: "e5", sent_at: "2025-12-01T10:00:00.000Z" }),
  ];

  it("agrupa pela conversa do Pipedrive; sem conversa, uma por e-mail", () => {
    const out = buildPipedriveThreads(rows, [], linkIdFor);
    expect(out).toHaveLength(4);
    const t10 = out.find((t) => t.messages.some((m) => m.id === "e1"))!;
    expect(t10.messages.map((m) => m.id)).toEqual(["e1", "e3"]);
    expect(out.find((t) => t.messages.some((m) => m.id === "e4"))!.messages).toHaveLength(1);
    expect(out.find((t) => t.messages.some((m) => m.id === "e5"))!.messages).toHaveLength(1);
    expect(new Set(out.map((t) => t.threadId)).size).toBe(4);
  });

  it("marca a origem e não deixa responder nem desvincular", () => {
    const [t] = buildPipedriveThreads([rows[0]], [], linkIdFor);
    expect(t).toMatchObject({
      source: "pipedrive",
      accountId: "",
      gmailThreadId: "",
      accountEmail: null,
      isMine: false,
      canUnlink: false,
      linkId: "link-e1",
      subject: "Proposta",
    });
  });

  it("mensagens em ordem de envio crescente e conversas da mais recente para a mais antiga", () => {
    const out = buildPipedriveThreads(rows, [], linkIdFor);
    expect(out.map((t) => t.lastMessageAt)).toEqual([
      "2026-03-01T10:00:00.000Z",
      "2026-02-01T10:00:00.000Z",
      "2026-01-03T10:00:00.000Z",
      "2025-12-01T10:00:00.000Z",
    ]);
    const t10 = out[2];
    expect(t10.messages.map((m) => m.sentAt)).toEqual(["2026-01-01T10:00:00.000Z", "2026-01-03T10:00:00.000Z"]);
    // Assunto da primeira mensagem da conversa.
    expect(t10.subject).toBe("Proposta");
  });

  it("mensagem com os campos da tela e o Message-ID", () => {
    const [t] = buildPipedriveThreads(
      [email({ id: "e1", rfc_message_id: "<a@x>", snippet: "D&amp;D", to: [{ email: "b@x.com" }, "lixo"], direction: "out" })],
      [],
      linkIdFor,
    );
    expect(t.messages[0]).toEqual({
      id: "e1",
      gmailMessageId: "",
      fromEmail: "ana@cliente.com",
      fromName: "Ana",
      to: [{ email: "b@x.com", name: null }],
      cc: [],
      sentAt: "2026-01-01T10:00:00.000Z",
      snippet: "D&D",
      rfcMessageId: "<a@x>",
      attachments: [],
      direction: "out",
    });
  });

  it("anexos vêm dos arquivos do e-mail, com fileId", () => {
    const files: PipedriveAttachmentRow[] = [
      { id: "f1", email_id: "e1", filename: "proposta.pdf" },
      { id: "f2", email_id: "e1", filename: "" },
      { id: "f3", email_id: "e3", filename: "contrato.pdf" },
      { id: "f4", email_id: "outro", filename: "solto.pdf" },
    ];
    const out = buildPipedriveThreads(rows, files, linkIdFor);
    const t10 = out.find((t) => t.messages.some((m) => m.id === "e1"))!;
    expect(t10.messages[0].attachments).toEqual([
      { filename: "proposta.pdf", fileId: "f1" },
      { filename: "(sem nome)", fileId: "f2" },
    ]);
    expect(t10.messages[1].attachments).toEqual([{ filename: "contrato.pdf", fileId: "f3" }]);
    expect(out.flatMap((t) => t.messages).find((m) => m.id === "e2")!.attachments).toEqual([]);
  });
});

describe("dropImportedDuplicates", () => {
  const view = (id: string, rfcMessageId: string | null, sentAt: string): ThreadMessageView => ({
    id,
    gmailMessageId: "",
    fromEmail: "ana@cliente.com",
    fromName: null,
    to: [],
    cc: [],
    sentAt,
    snippet: "",
    rfcMessageId,
    attachments: [],
    direction: "in",
  });
  const thread = (threadId: string, source: RecordThread["source"], messages: ThreadMessageView[]): RecordThread => ({
    threadId,
    source,
    accountId: "",
    gmailThreadId: "",
    linkId: threadId,
    subject: "x",
    lastMessageAt: messages[messages.length - 1]?.sentAt ?? null,
    accountEmail: null,
    isMine: false,
    canUnlink: false,
    messages,
  });

  const gmail = [
    thread("g1", "gmail", [view("gm1", "<dup@x>", "2026-01-01T10:00:00Z"), view("gm2", null, "2026-01-02T10:00:00Z")]),
    thread("g2", "gmail", [view("gm3", "<DUP2@X>", "2026-01-05T10:00:00Z")]),
  ];

  it("tira a mensagem que já veio pelo Gmail e a conversa que fica vazia", () => {
    const imported = [
      thread("p1", "pipedrive", [view("pm1", "<dup@x>", "2026-01-01T10:00:00Z")]),
      thread("p2", "pipedrive", [view("pm2", "<so-minha@x>", "2026-01-01T09:00:00Z"), view("pm3", "dup2@x", "2026-01-05T10:00:00Z")]),
      thread("p3", "pipedrive", [view("pm4", null, "2026-01-03T10:00:00Z")]),
    ];
    const out = dropImportedDuplicates(gmail, imported);
    expect(out.map((t) => t.threadId)).toEqual(["p3", "p2"]);
    const p2 = out.find((t) => t.threadId === "p2")!;
    expect(p2.messages.map((m) => m.id)).toEqual(["pm2"]);
    // A data da conversa passa a ser a da última mensagem que ficou.
    expect(p2.lastMessageAt).toBe("2026-01-01T09:00:00Z");
    expect(out.find((t) => t.threadId === "p3")!.messages.map((m) => m.id)).toEqual(["pm4"]);
  });

  it("sem Message-ID em comum, nada muda", () => {
    const imported = [thread("p1", "pipedrive", [view("pm1", "<outro@x>", "2026-01-01T10:00:00Z")])];
    expect(dropImportedDuplicates(gmail, imported)).toEqual(imported);
    expect(dropImportedDuplicates([], imported)).toEqual(imported);
  });
});

describe("toRecordFileView", () => {
  const row = {
    id: "f1",
    filename: "contrato.pdf",
    size: 2048,
    created_at: "2026-01-01T10:00:00Z",
    storage_path: "c/f1/contrato.pdf",
    remote_url: null,
  };

  it("arquivo no Storage", () => {
    expect(toRecordFileView(row)).toEqual({
      id: "f1",
      filename: "contrato.pdf",
      size: 2048,
      createdAt: "2026-01-01T10:00:00Z",
      remote: false,
      available: true,
    });
  });

  it("link externo e arquivo que não foi trazido", () => {
    expect(toRecordFileView({ ...row, storage_path: null, remote_url: "https://drive.google.com/x", size: null })).toMatchObject({
      remote: true,
      available: true,
      size: null,
    });
    expect(toRecordFileView({ ...row, storage_path: null, size: "30000000" })).toMatchObject({
      remote: false,
      available: false,
      size: 30_000_000,
    });
  });
});

describe("formatFileSize", () => {
  it("bytes, KB e MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1_572_864)).toBe("1,5 MB");
    expect(formatFileSize(26_214_400)).toBe("25 MB");
  });

  it("tamanho desconhecido fica vazio", () => {
    expect(formatFileSize(null)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
  });
});
