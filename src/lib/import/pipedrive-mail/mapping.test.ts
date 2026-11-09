import { describe, expect, it } from "vitest";
import {
  classifyFile,
  fileAddedAt,
  fileName,
  isRemoteFile,
  isWebUrl,
  mapMailMessage,
  MAX_BODY_CHARS,
  MAX_FILE_BYTES,
  type PdMailMessage,
  safeName,
  storagePath,
} from "./mapping";

const OWNER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const base: PdMailMessage = {
  id: 10,
  mail_thread_id: 7,
  subject: "Proposta",
  snippet: "Segue a proposta",
  from: [{ email_address: "ana@cliente.com", name: "Ana" }],
  to: [{ email_address: "vendas@oxyn.com", name: "Vendas" }],
  cc: [],
  message_time: "2026-03-02 14:05:00",
  add_time: "2026-03-03 09:00:00",
  mua_message_id: "<abc@mail.cliente.com>",
  sent_flag: 0,
};

describe("constantes", () => {
  it("usam os limites da spec", () => {
    expect(MAX_BODY_CHARS).toBe(1_048_576);
    expect(MAX_FILE_BYTES).toBe(26_214_400);
  });
});

describe("mapMailMessage", () => {
  it("mapeia uma mensagem completa", () => {
    expect(mapMailMessage(base, { ownerId: OWNER, body: "<p>oi</p>" })).toEqual({
      pipedrive_id: 10,
      pipedrive_thread_id: 7,
      owner_id: OWNER,
      subject: "Proposta",
      from_email: "ana@cliente.com",
      from_name: "Ana",
      to: [{ email: "vendas@oxyn.com", name: "Vendas" }],
      cc: [],
      sent_at: "2026-03-02T14:05:00.000Z",
      snippet: "Segue a proposta",
      body_html: "<p>oi</p>",
      rfc_message_id: "<abc@mail.cliente.com>",
      direction: "in",
    });
  });

  it("sent_flag 1 ou true é saída; o resto é entrada", () => {
    const ctx = { ownerId: null, body: null };
    expect(mapMailMessage({ ...base, sent_flag: 1 }, ctx).direction).toBe("out");
    expect(mapMailMessage({ ...base, sent_flag: true }, ctx).direction).toBe("out");
    expect(mapMailMessage({ ...base, sent_flag: 0 }, ctx).direction).toBe("in");
    expect(mapMailMessage({ ...base, sent_flag: false }, ctx).direction).toBe("in");
    expect(mapMailMessage({ ...base, sent_flag: null }, ctx).direction).toBe("in");
    expect(mapMailMessage({ ...base, sent_flag: undefined }, ctx).direction).toBe("in");
  });

  it("message_time do Pipedrive (UTC) vira ISO com Z", () => {
    const ctx = { ownerId: null, body: null };
    expect(mapMailMessage({ ...base, message_time: "2026-03-02 14:05:00" }, ctx).sent_at).toBe("2026-03-02T14:05:00.000Z");
  });

  it("sem message_time usa add_time; sem os dois usa 1970", () => {
    const ctx = { ownerId: null, body: null };
    expect(mapMailMessage({ ...base, message_time: null }, ctx).sent_at).toBe("2026-03-03T09:00:00.000Z");
    expect(mapMailMessage({ ...base, message_time: null, add_time: null }, ctx).sent_at).toBe("1970-01-01T00:00:00.000Z");
    expect(mapMailMessage({ ...base, message_time: undefined, add_time: undefined }, ctx).sent_at).toBe("1970-01-01T00:00:00.000Z");
  });

  it("data inválida cai nos padrões em vez de derrubar o lote", () => {
    const ctx = { ownerId: null, body: null };
    expect(mapMailMessage({ ...base, message_time: "2026-13-45 99:99:99", add_time: null }, ctx).sent_at).toBe("1970-01-01T00:00:00.000Z");
    expect(mapMailMessage({ ...base, message_time: "lixo" }, ctx).sent_at).toBe("2026-03-03T09:00:00.000Z");
  });

  it("corta o corpo no tamanho máximo exato", () => {
    const big = "a".repeat(MAX_BODY_CHARS + 500);
    const row = mapMailMessage(base, { ownerId: null, body: big });
    expect(row.body_html).toHaveLength(MAX_BODY_CHARS);
    const exact = "b".repeat(MAX_BODY_CHARS);
    expect(mapMailMessage(base, { ownerId: null, body: exact }).body_html).toBe(exact);
  });

  it("corpo nulo vira body_html null", () => {
    expect(mapMailMessage(base, { ownerId: null, body: null }).body_html).toBeNull();
  });

  it("from vazio ou nulo vira e-mail vazio e nome null", () => {
    const ctx = { ownerId: null, body: null };
    for (const from of [[], null, undefined]) {
      const row = mapMailMessage({ ...base, from }, ctx);
      expect(row.from_email).toBe("");
      expect(row.from_name).toBeNull();
    }
    const semEmail = mapMailMessage({ ...base, from: [{ name: "Sem e-mail" }] }, ctx);
    expect(semEmail.from_email).toBe("");
  });

  it("from sem nome fica com nome null", () => {
    const row = mapMailMessage({ ...base, from: [{ email_address: "x@y.com" }] }, { ownerId: null, body: null });
    expect(row.from_email).toBe("x@y.com");
    expect(row.from_name).toBeNull();
  });

  it("to e cc viram {email, name} e descartam itens sem e-mail", () => {
    const row = mapMailMessage(
      {
        ...base,
        to: [{ email_address: "a@x.com", name: "A" }, { email_address: "", name: "Vazio" }, { name: "Sem" }, { email_address: "b@x.com" }],
        cc: [{ email_address: "c@x.com", name: null }, { email_address: null }],
      },
      { ownerId: null, body: null },
    );
    expect(row.to).toEqual([
      { email: "a@x.com", name: "A" },
      { email: "b@x.com", name: null },
    ]);
    expect(row.cc).toEqual([{ email: "c@x.com", name: null }]);
  });

  it("to e cc nulos viram listas vazias", () => {
    const row = mapMailMessage({ ...base, to: null, cc: undefined }, { ownerId: null, body: null });
    expect(row.to).toEqual([]);
    expect(row.cc).toEqual([]);
  });

  it("subject e snippet nulos viram texto vazio", () => {
    const row = mapMailMessage({ ...base, subject: null, snippet: undefined }, { ownerId: null, body: null });
    expect(row.subject).toBe("");
    expect(row.snippet).toBe("");
  });

  it("mua_message_id vai para rfc_message_id e vazio vira null", () => {
    const ctx = { ownerId: null, body: null };
    expect(mapMailMessage(base, ctx).rfc_message_id).toBe("<abc@mail.cliente.com>");
    expect(mapMailMessage({ ...base, mua_message_id: "" }, ctx).rfc_message_id).toBeNull();
    expect(mapMailMessage({ ...base, mua_message_id: null }, ctx).rfc_message_id).toBeNull();
  });

  it("mail_thread_id ausente vira null e owner_id segue o contexto", () => {
    const row = mapMailMessage({ ...base, mail_thread_id: undefined }, { ownerId: null, body: null });
    expect(row.pipedrive_thread_id).toBeNull();
    expect(row.owner_id).toBeNull();
  });

  it("limpa NUL e substitutos soltos dos textos (o Postgres recusaria)", () => {
    const row = mapMailMessage(
      {
        ...base,
        subject: "Pro\u0000posta",
        snippet: "a\ud800b",
        from: [{ email_address: "ana@cliente.com", name: "A\u0000na" }],
        to: [{ email_address: "b@x.com", name: "B\udc00" }],
        cc: [{ email_address: "c@x.com", name: "C\u0000" }],
      },
      { ownerId: null, body: "<p>o\u0000i</p>" },
    );
    expect(row.subject).toBe("Proposta");
    expect(row.snippet).toBe("a\ufffdb");
    expect(row.from_name).toBe("Ana");
    expect(row.to).toEqual([{ email: "b@x.com", name: "B\ufffd" }]);
    expect(row.cc).toEqual([{ email: "c@x.com", name: "C" }]);
    expect(row.body_html).toBe("<p>oi</p>");
  });

  it("corte do corpo no meio de um par substituto não deixa substituto solto", () => {
    const body = "a".repeat(MAX_BODY_CHARS - 1) + "😀";
    const out = mapMailMessage(base, { ownerId: null, body }).body_html!;
    expect(out).toHaveLength(MAX_BODY_CHARS);
    expect(out.endsWith("\ufffd")).toBe(true);
    expect(out.isWellFormed()).toBe(true);
  });

  it("mensagem só com o id não quebra", () => {
    const row = mapMailMessage({ id: 1 }, { ownerId: null, body: null });
    expect(row).toEqual({
      pipedrive_id: 1,
      pipedrive_thread_id: null,
      owner_id: null,
      subject: "",
      from_email: "",
      from_name: null,
      to: [],
      cc: [],
      sent_at: "1970-01-01T00:00:00.000Z",
      snippet: "",
      body_html: null,
      rfc_message_id: null,
      direction: "in",
    });
  });
});

describe("classifyFile", () => {
  it("arquivo inline é pulado", () => {
    expect(classifyFile({ id: 1, inline_flag: true, mail_message_id: 5 })).toEqual({ kind: "skip", reason: "inline" });
    expect(classifyFile({ id: 1, inline_flag: 1, deal_id: 3 })).toEqual({ kind: "skip", reason: "inline" });
  });

  it("inline vence o ics", () => {
    expect(classifyFile({ id: 1, inline_flag: true, file_type: "ics" })).toEqual({ kind: "skip", reason: "inline" });
  });

  it("ics é pulado pelo tipo ou pelo nome, sem diferenciar maiúsculas, inclusive quando é de e-mail", () => {
    expect(classifyFile({ id: 1, file_type: "ics", deal_id: 3 })).toEqual({ kind: "skip", reason: "ics" });
    expect(classifyFile({ id: 1, file_type: "ICS", mail_message_id: 5 })).toEqual({ kind: "skip", reason: "ics" });
    expect(classifyFile({ id: 1, file_name: "convite.ICS", mail_message_id: 5 })).toEqual({ kind: "skip", reason: "ics" });
    expect(classifyFile({ id: 1, name: "reuniao.ics", deal_id: 3 })).toEqual({ kind: "skip", reason: "ics" });
  });

  it("arquivo de e-mail vai para a mensagem, antes dos registros", () => {
    expect(classifyFile({ id: 1, mail_message_id: 5, deal_id: 3 })).toEqual({ kind: "email", pdMessageId: 5 });
  });

  it("segue a ordem deal, lead, pessoa, organização, atividade", () => {
    expect(classifyFile({ id: 1, deal_id: 3, lead_id: "abc", person_id: 4, org_id: 5, activity_id: 6 })).toEqual({ kind: "record", entity: "deals", pdId: "3" });
    expect(classifyFile({ id: 1, lead_id: "abc", person_id: 4, org_id: 5, activity_id: 6 })).toEqual({ kind: "record", entity: "leads", pdId: "abc" });
    expect(classifyFile({ id: 1, person_id: 4, org_id: 5, activity_id: 6 })).toEqual({ kind: "record", entity: "persons", pdId: "4" });
    expect(classifyFile({ id: 1, org_id: 5, activity_id: 6 })).toEqual({ kind: "record", entity: "organizations", pdId: "5" });
    expect(classifyFile({ id: 1, activity_id: 6 })).toEqual({ kind: "activity", pdActivityId: 6 });
    expect(classifyFile({ id: 1 })).toEqual({ kind: "skip", reason: "no_target" });
  });

  it("ignora vínculos nulos", () => {
    expect(classifyFile({ id: 1, deal_id: null, lead_id: null, person_id: 9 })).toEqual({ kind: "record", entity: "persons", pdId: "9" });
  });

  it("o pdId é sempre string", () => {
    const t = classifyFile({ id: 1, deal_id: 42 });
    expect(t).toEqual({ kind: "record", entity: "deals", pdId: "42" });
  });
});

describe("isRemoteFile", () => {
  it("remote_location diferente de s3 é remoto", () => {
    expect(isRemoteFile({ id: 1, remote_location: "googledocs" })).toBe(true);
    expect(isRemoteFile({ id: 1, remote_location: "gdrive" })).toBe(true);
  });

  it("s3, vazio ou ausente não é remoto", () => {
    expect(isRemoteFile({ id: 1, remote_location: "s3" })).toBe(false);
    expect(isRemoteFile({ id: 1, remote_location: "" })).toBe(false);
    expect(isRemoteFile({ id: 1, remote_location: null })).toBe(false);
    expect(isRemoteFile({ id: 1 })).toBe(false);
  });
});

describe("fileName", () => {
  it("usa file_name, depois name, depois arquivo-{id}", () => {
    expect(fileName({ id: 9, file_name: "a.pdf", name: "b.pdf" })).toBe("a.pdf");
    expect(fileName({ id: 9, file_name: null, name: "b.pdf" })).toBe("b.pdf");
    expect(fileName({ id: 9 })).toBe("arquivo-9");
  });

  it("nome vazio cai no próximo; o nome original fica com acentos e símbolos", () => {
    expect(fileName({ id: 9, file_name: "", name: "b.pdf" })).toBe("b.pdf");
    expect(fileName({ id: 9, file_name: "", name: "" })).toBe("arquivo-9");
    expect(fileName({ id: 9, file_name: "Orçamento #3?.pdf" })).toBe("Orçamento #3?.pdf");
    expect(fileName({ id: 9, file_name: "a\u0000b.pdf" })).toBe("ab.pdf");
  });

  it("troca barras por sublinhado", () => {
    expect(fileName({ id: 9, file_name: "pasta/sub\\arq.pdf" })).toBe("pasta_sub_arq.pdf");
    expect(fileName({ id: 9, name: "../../etc/passwd" })).toBe(".._.._etc_passwd");
  });
});

describe("safeName", () => {
  it("tira os acentos e troca o que não é [A-Za-z0-9._-] por _", () => {
    expect(safeName("Orçamento.pdf")).toBe("Orcamento.pdf");
    expect(safeName("Proposta técnica.docx")).toBe("Proposta_tecnica.docx");
    expect(safeName("Pedido #12.pdf")).toBe("Pedido__12.pdf");
    expect(safeName("o que?.pdf")).toBe("o_que_.pdf");
    expect(safeName("Desconto 10%.pdf")).toBe("Desconto_10_.pdf");
    expect(safeName("contrato_v2-final.PDF")).toBe("contrato_v2-final.PDF");
    expect(safeName("日本.txt")).toBe("__.txt");
    expect(safeName("😀.png")).toBe("_.png");
  });

  it("sem .. nem ponto no início", () => {
    expect(safeName("../../etc/passwd")).toBe("_._etc_passwd");
    expect(safeName("a..b...pdf")).toBe("a.b.pdf");
    expect(safeName(".htaccess")).toBe("htaccess");
    expect(safeName("..")).toBe("arquivo");
  });

  it("vazio vira arquivo", () => {
    expect(safeName("")).toBe("arquivo");
    expect(safeName("...")).toBe("arquivo");
  });

  it("corta em 120 caracteres preservando a extensão", () => {
    const long = `${"a".repeat(200)}.pdf`;
    const out = safeName(long);
    expect(out).toHaveLength(120);
    expect(out).toBe(`${"a".repeat(116)}.pdf`);
    // extensão longa demais não é preservada: corte simples
    expect(safeName(`x.${"b".repeat(200)}`)).toBe(`x.${"b".repeat(118)}`);
    // o corte não cria ..
    expect(safeName(`${"a".repeat(115)}.${"c".repeat(10)}.pdf`)).not.toContain("..");
    expect(safeName("curto.pdf")).toBe("curto.pdf");
  });

  it("é determinístico", () => {
    expect(safeName("Orçamento #3?.pdf")).toBe(safeName("Orçamento #3?.pdf"));
  });
});

describe("storagePath", () => {
  it("{empresa}/pd-{id do Pipedrive}/{nome seguro}, sempre o mesmo para o mesmo arquivo", () => {
    expect(storagePath("c1", 55, "Orçamento #3?.pdf")).toBe("c1/pd-55/Orcamento__3_.pdf");
    expect(storagePath("c1", 55, "")).toBe("c1/pd-55/arquivo");
    expect(storagePath("c1", 55, "a.pdf")).toBe(storagePath("c1", 55, "a.pdf"));
  });
});

describe("fileAddedAt", () => {
  it("add_time do Pipedrive (UTC) vira ISO; vazio ou inválido vira null", () => {
    expect(fileAddedAt({ id: 1, add_time: "2025-05-10 08:30:00" })).toBe("2025-05-10T08:30:00.000Z");
    expect(fileAddedAt({ id: 1, add_time: null })).toBeNull();
    expect(fileAddedAt({ id: 1 })).toBeNull();
    expect(fileAddedAt({ id: 1, add_time: "lixo" })).toBeNull();
    expect(fileAddedAt({ id: 1, add_time: "2025-13-45 99:99:99" })).toBeNull();
  });
});

describe("isWebUrl", () => {
  it("só http(s)", () => {
    expect(isWebUrl("https://docs.google.com/x")).toBe(true);
    expect(isWebUrl("http://x.com")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("data:text/html,oi")).toBe(false);
    expect(isWebUrl("lixo")).toBe(false);
    expect(isWebUrl("")).toBe(false);
    expect(isWebUrl(null)).toBe(false);
    expect(isWebUrl(undefined)).toBe(false);
  });
});
