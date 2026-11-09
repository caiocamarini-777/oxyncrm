import { isWebUrl } from "@/lib/import/pipedrive-mail/mapping";

/** Bucket privado dos arquivos importados (criado na migration). */
export const RECORD_FILES_BUCKET = "record-files";
/** Validade da URL assinada do download, em segundos. */
export const SIGNED_URL_SECONDS = 60;

/** Linha de `record_files` que a rota lê (pelo cliente do usuário: a RLS confere o acesso). */
export type RecordFileLink = { filename: string; storage_path: string | null; remote_url: string | null };

type DbResult = { data: RecordFileLink | null; error: { message: string; code?: string } | null };
type Signer = {
  createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
};

export type RecordFileUrl = { ok: true; url: string } | { ok: false; status: 404 | 500; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Para onde a rota `/api/arquivos/[id]` manda o navegador. A linha é lida primeiro pelo cliente do usuário
 * (`readFile`), então a RLS (`can_read_record_file`) decide o acesso; só depois o cliente administrativo
 * (`storage`, o bucket não tem policy para usuários) assina a URL de 60 segundos.
 *
 * O nome original vai no `download` da URL assinada: o Storage responde como anexo (um HTML ou SVG de remetente
 * externo não é renderizado) e o navegador salva com o nome certo. O parâmetro é posto aqui, com uma só
 * codificação: o `{ download }` do storage-js 2.118 codifica o nome duas vezes (um "Orçamento.pdf" seria salvo
 * como "Or%C3%A7amento.pdf").
 *
 * Sem acesso ou inexistente: 404 (não diz qual dos dois).
 */
export async function resolveRecordFileUrl(
  fileId: string,
  deps: { readFile: (id: string) => PromiseLike<DbResult>; storage: (bucket: string) => Signer },
): Promise<RecordFileUrl> {
  const notFound = { ok: false, status: 404, message: "Arquivo não encontrado." } as const;
  if (!UUID.test(fileId)) return notFound;

  const { data: file, error } = await deps.readFile(fileId);
  if (error) {
    console.error("[arquivos] leitura:", error.code, error.message);
    return { ok: false, status: 500, message: "Não foi possível abrir o arquivo. Tente novamente." };
  }
  if (!file) return notFound;

  if (file.storage_path) {
    const signed = await deps.storage(RECORD_FILES_BUCKET).createSignedUrl(file.storage_path, SIGNED_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) {
      console.error("[arquivos] url assinada:", signed.error?.message);
      return { ok: false, status: 500, message: "Não foi possível abrir o arquivo. Tente novamente." };
    }
    const name = file.filename || "arquivo";
    const sep = signed.data.signedUrl.includes("?") ? "&" : "?";
    return { ok: true, url: `${signed.data.signedUrl}${sep}download=${encodeURIComponent(name)}` };
  }
  if (isWebUrl(file.remote_url)) return { ok: true, url: file.remote_url };
  if (file.remote_url) return { ok: false, status: 404, message: "O link deste arquivo é inválido." };
  return { ok: false, status: 404, message: "Este arquivo não foi trazido do Pipedrive (maior que 25 MB)." };
}
