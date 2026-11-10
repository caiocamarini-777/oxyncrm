import { connection, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { resolveRecordFileUrl } from "@/lib/pipedrive-mail/file-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@/lib/supabase/server";

/**
 * Download de um arquivo importado do Pipedrive (do card ou anexo de e-mail). A tela abre este endereço num
 * link comum (`target="_blank"`), sem `window.open` depois de uma ida ao servidor, que o Safari bloqueia.
 * Exige sessão: o proxy já barra quem não entrou e a leitura passa pela RLS do usuário (`resolveRecordFileUrl`).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const text = (message: string, status: number) =>
    new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

  const profile = await getCurrentProfile();
  if (!profile) return text("Arquivo não encontrado.", 404);

  const supabase = await createServerClient();
  const result = await resolveRecordFileUrl(id, {
    readFile: (fileId) =>
      supabase
        .from("record_files")
        .select("filename, storage_path, remote_url")
        .eq("id", fileId)
        .is("deleted_at", null)
        .maybeSingle(),
    storage: (bucket) => createAdminClient().storage.from(bucket),
  });
  if (!result.ok) return text(result.message, result.status);

  // A URL assinada vale 60 segundos: o redirecionamento não pode ficar em cache.
  const res = NextResponse.redirect(result.url, 302);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
