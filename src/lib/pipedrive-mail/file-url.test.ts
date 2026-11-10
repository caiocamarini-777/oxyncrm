import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRecordFileUrl, type RecordFileLink } from "./file-url";

const ID = "2b1e0b3c-5c1a-4d7e-9f00-123456789abc";
const SIGNED = "https://sb.test/storage/v1/object/sign/record-files/c/pd-7/Orcamento.pdf?token=abc";

type Read = { data: RecordFileLink | null; error: { message: string; code?: string } | null };
type Sign = { data: { signedUrl: string } | null; error: { message: string } | null };

/** Dependências falsas: a leitura (RLS do usuário) e o Storage (cliente administrativo) registram as chamadas. */
function deps(read: Read, sign: Sign = { data: { signedUrl: SIGNED }, error: null }) {
  const reads: string[] = [];
  const signs: { bucket: string; path: string; expiresIn: number; extra: unknown[] }[] = [];
  return {
    reads,
    signs,
    deps: {
      readFile: async (id: string) => {
        reads.push(id);
        return read;
      },
      storage: (bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number, ...extra: unknown[]) => {
          signs.push({ bucket, path, expiresIn, extra });
          return sign;
        },
      }),
    },
  };
}

const file = (over: Partial<RecordFileLink>): RecordFileLink => ({
  filename: "Orçamento final.pdf",
  storage_path: "c/pd-7/Orcamento_final.pdf",
  remote_url: null,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("resolveRecordFileUrl", () => {
  it("arquivo no Storage: assina por 60 segundos no bucket record-files e força o download com o nome original", async () => {
    const d = deps({ data: file({}), error: null });
    const r = await resolveRecordFileUrl(ID, d.deps);
    expect(d.reads).toEqual([ID]);
    expect(d.signs).toEqual([{ bucket: "record-files", path: "c/pd-7/Orcamento_final.pdf", expiresIn: 60, extra: [] }]);
    expect(r).toEqual({ ok: true, url: `${SIGNED}&download=Or%C3%A7amento%20final.pdf` });
    // o Storage lê o nome original, com uma só decodificação
    expect(new URL((r as { url: string }).url).searchParams.get("download")).toBe("Orçamento final.pdf");
  });

  it("nome com # & % não quebra a URL", async () => {
    const d = deps({ data: file({ filename: "Pedido #12 & 10%.pdf" }), error: null });
    const r = await resolveRecordFileUrl(ID, d.deps);
    const u = new URL((r as { url: string }).url);
    expect(u.searchParams.get("download")).toBe("Pedido #12 & 10%.pdf");
    expect(u.searchParams.get("token")).toBe("abc");
    expect(u.hash).toBe("");
  });

  it("nome vazio baixa como arquivo", async () => {
    const d = deps({ data: file({ filename: "" }), error: null });
    const r = await resolveRecordFileUrl(ID, d.deps);
    expect(new URL((r as { url: string }).url).searchParams.get("download")).toBe("arquivo");
  });

  it("link externo http(s) vai como está, sem assinar", async () => {
    const d = deps({ data: file({ storage_path: null, remote_url: "https://docs.google.com/x" }), error: null });
    expect(await resolveRecordFileUrl(ID, d.deps)).toEqual({ ok: true, url: "https://docs.google.com/x" });
    expect(d.signs).toEqual([]);
  });

  it("link externo que não é http(s): 404", async () => {
    const d = deps({ data: file({ storage_path: null, remote_url: "javascript:alert(1)" }), error: null });
    expect(await resolveRecordFileUrl(ID, d.deps)).toEqual({ ok: false, status: 404, message: "O link deste arquivo é inválido." });
  });

  it("sem storage_path nem remote_url (maior que 25 MB): 404 com texto curto", async () => {
    const d = deps({ data: file({ storage_path: null, remote_url: null }), error: null });
    expect(await resolveRecordFileUrl(ID, d.deps)).toEqual({
      ok: false,
      status: 404,
      message: "Este arquivo não foi trazido do Pipedrive (maior que 25 MB).",
    });
    expect(d.signs).toEqual([]);
  });

  it("sem acesso (a RLS não devolve a linha) ou inexistente: 404, sem assinar", async () => {
    const d = deps({ data: null, error: null });
    expect(await resolveRecordFileUrl(ID, d.deps)).toEqual({ ok: false, status: 404, message: "Arquivo não encontrado." });
    expect(d.signs).toEqual([]);
  });

  it("id que não é uuid: 404 sem ler o banco", async () => {
    for (const bad of ["", "abc", `${ID}x`, "../etc"]) {
      const d = deps({ data: file({}), error: null });
      expect(await resolveRecordFileUrl(bad, d.deps)).toMatchObject({ ok: false, status: 404 });
      expect(d.reads).toEqual([]);
    }
  });

  it("erro na leitura ou na assinatura: 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const readErr = deps({ data: null, error: { message: "boom", code: "XX000" } });
    expect(await resolveRecordFileUrl(ID, readErr.deps)).toMatchObject({ ok: false, status: 500 });
    expect(readErr.signs).toEqual([]);

    const signErr = deps({ data: file({}), error: null }, { data: null, error: { message: "Object not found" } });
    expect(await resolveRecordFileUrl(ID, signErr.deps)).toMatchObject({ ok: false, status: 500 });
  });
});
