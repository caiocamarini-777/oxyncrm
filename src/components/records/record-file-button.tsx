"use client";

import { useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getRecordFileUrl } from "@/lib/pipedrive-mail/actions";

/**
 * Abre um arquivo importado do Pipedrive (do card ou anexo de e-mail) numa nova aba. A URL assinada dura
 * 60 segundos e é pedida na hora do clique (`getRecordFileUrl` confere o acesso); link externo vem como está.
 */
export function useOpenRecordFile(fileId: string) {
  const [busy, setBusy] = useState(false);

  async function open() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await getRecordFileUrl(fileId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      window.open(res.data.url, "_blank", "noopener");
    } catch {
      toast.error("Não foi possível abrir o arquivo. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return { busy, open };
}

/** Botão da seção Arquivos: "Baixar" para arquivo guardado, "Abrir" para link externo (Google Drive etc.). */
export function RecordFileButton({ fileId, filename, remote }: { fileId: string; filename: string; remote: boolean }) {
  const { busy, open } = useOpenRecordFile(fileId);
  const Icon = remote ? ExternalLink : Download;
  const label = remote ? "Abrir" : "Baixar";
  return (
    <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`${label} ${filename}`} onClick={() => void open()}>
      <Icon /> {label}
    </Button>
  );
}
