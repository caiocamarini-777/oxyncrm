import Link from "next/link";
import { Trash2 } from "lucide-react";

/** Link "Lixeira" no rodapé das listas; só para quem pode excluir em alguma empresa. */
export function TrashLink({ scopeSlug, tab }: { scopeSlug: string; tab: "leads" | "pessoas" | "organizacoes" }) {
  return (
    <div className="flex justify-end">
      <Link
        href={`/${scopeSlug}/lixeira?aba=${tab}`}
        prefetch={false}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <Trash2 className="size-4" /> Lixeira
      </Link>
    </div>
  );
}
