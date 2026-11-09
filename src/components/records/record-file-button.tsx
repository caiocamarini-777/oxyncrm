import { Download, ExternalLink } from "lucide-react";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { recordFileHref } from "@/lib/pipedrive-mail/view";

/**
 * Botão da seção Arquivos: "Baixar" para arquivo guardado, "Abrir" para link externo (Google Drive etc.). É um
 * link comum para a rota `/api/arquivos/[id]`, que confere o acesso e redireciona para a URL assinada de 60
 * segundos (ou para o link externo): abre no próprio clique, sem pop-up que o Safari bloqueie.
 */
export function RecordFileButton({ fileId, filename, remote }: { fileId: string; filename: string; remote: boolean }) {
  const Icon = remote ? ExternalLink : Download;
  const label = remote ? "Abrir" : "Baixar";
  return (
    <a
      href={recordFileHref(fileId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} ${filename}`}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      <Icon /> {label}
    </a>
  );
}
