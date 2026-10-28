"use client";

import { Copy, Link2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createPublicLink, revokePublicLink, setShares, shareStateAction } from "@/lib/insights/actions";
import type { ShareState, ShareTarget } from "@/lib/insights/queries";

type Props = {
  kind: "report" | "dashboard";
  id: string;
  companyId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** só no painel: aba do link público */
  publicLink?: boolean;
};

/** "Compartilhar com usuários" (ver ou editar) e, no painel, "Compartilhar como link público". */
export function ShareDialog({ kind, id, companyId, open, onOpenChange, publicLink }: Props) {
  const [targets, setTargets] = useState<ShareTarget[] | null>(null);
  const [state, setState] = useState<ShareState | null>(null);
  const [sel, setSel] = useState<Record<string, "none" | "read" | "edit">>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    shareStateAction(kind, id, companyId).then((r) => {
      if (!r.ok) return toast.error(r.error);
      setTargets(r.data.targets);
      setState(r.data.state);
      setSel(Object.fromEntries(r.data.state.users.map((u) => [u.userId, u.canEdit ? "edit" : "read"])));
    });
  }, [open, kind, id, companyId]);

  async function save() {
    setBusy(true);
    const users = Object.entries(sel)
      .filter(([, v]) => v !== "none")
      .map(([userId, v]) => ({ userId, canEdit: v === "edit" }));
    const r = await setShares(kind, id, users);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Compartilhamento atualizado.");
    onOpenChange(false);
  }

  async function newLink() {
    const r = await createPublicLink(id);
    if (!r.ok) return toast.error(r.error);
    setUrl(r.data.url);
    setState((s) => (s ? { ...s, links: [{ id: r.data.id, createdAt: new Date().toISOString(), revokedAt: null }, ...s.links] } : s));
  }

  async function revoke(linkId: string) {
    const r = await revokePublicLink(linkId);
    if (!r.ok) return toast.error(r.error);
    setState((s) => (s ? { ...s, links: s.links.map((l) => (l.id === linkId ? { ...l, revokedAt: new Date().toISOString() } : l)) } : s));
  }

  const list = (targets ?? []).filter((t) => `${t.name} ${t.email}`.toLowerCase().includes(q.toLowerCase()));
  const active = state?.links.filter((l) => !l.revokedAt) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Compartilhar {kind === "report" ? "relatório" : "painel"}</DialogTitle>
        </DialogHeader>
        {!targets ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-3">
            <Input placeholder="Buscar pessoa" value={q} onChange={(e) => setQ(e.target.value)} />
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {list.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{t.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.email}</p>
                  </div>
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                    value={sel[t.id] ?? "none"}
                    aria-label={`Acesso de ${t.name}`}
                    onChange={(e) => setSel((s) => ({ ...s, [t.id]: e.target.value as "none" | "read" | "edit" }))}
                  >
                    <option value="none">Sem acesso</option>
                    <option value="read">Pode ver</option>
                    <option value="edit">Pode editar</option>
                  </select>
                </li>
              ))}
              {list.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">Ninguém encontrado.</li> : null}
            </ul>
            {publicLink ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Link2 className="size-4" /> Link público
                </p>
                <p className="text-xs text-muted-foreground">Quem tiver o link vê o painel com os dados que você vê, sem entrar no CRM.</p>
                {url ? (
                  <div className="flex gap-1">
                    <Input readOnly value={url} className="h-8 text-xs" onFocus={(e) => e.target.select()} />
                    <Button size="icon" variant="outline" className="size-8" aria-label="Copiar link" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copiado."))}>
                      <Copy className="size-4" />
                    </Button>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={newLink}>
                    Gerar link
                  </Button>
                  {active.map((l) => (
                    <Button key={l.id} size="sm" variant="ghost" className="text-destructive" onClick={() => revoke(l.id)}>
                      Revogar link de {new Date(l.createdAt).toLocaleDateString("pt-BR")}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy || !targets}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
