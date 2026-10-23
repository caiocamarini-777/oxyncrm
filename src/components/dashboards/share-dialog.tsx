"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TZ } from "@/lib/activities/time";
import { createShareLink, revokeShareLink, shareDashboard, unshareDashboard } from "@/lib/reports/actions";

export type ShareUser = { id: string; name: string; email: string };
export type LinkStatus = "ativo" | "expirado" | "revogado";
export type ShareLinkItem = { id: string; createdAt: string; expiresAt: string | null; status: LinkStatus };

const EXPIRY = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "never", label: "Nunca" },
] as const;

const STATUS_LABEL: Record<LinkStatus, string> = { ativo: "Ativo", expirado: "Expirado", revogado: "Revogado" };

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(new Date(iso));

type Tab = "usuarios" | "link";

/** Compartilhamento do dashboard: com pessoas das empresas do dono e por link público. */
export function ShareDialog({
  dashboardId,
  users,
  sharedWith,
  names = {},
  links,
}: {
  dashboardId: string;
  users: ShareUser[];
  sharedWith: string[];
  /** Nomes de quem já tem acesso e não está na lista de pessoas disponíveis. */
  names?: Record<string, string>;
  links: ShareLinkItem[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("usuarios");
  const [shared, setShared] = useState(() => new Set(sharedWith));
  const [items, setItems] = useState(links);
  const [query, setQuery] = useState("");
  const [expiry, setExpiry] = useState<string>("30");
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const term = query.trim().toLocaleLowerCase("pt-BR");
  const matches = (u: ShareUser) => !term || `${u.name} ${u.email}`.toLocaleLowerCase("pt-BR").includes(term);
  // Quem já recebeu o dashboard mas saiu da lista (inativo ou fora das empresas) continua removível.
  const known = new Map(users.map((u) => [u.id, u]));
  const withAccess: ShareUser[] = [...shared].map(
    (id) => known.get(id) ?? { id, name: names[id] ?? "Pessoa sem acesso às suas empresas", email: "" },
  );
  const available = users.filter((u) => !shared.has(u.id) && matches(u));

  function add(u: ShareUser) {
    setError(null);
    startTransition(async () => {
      const res = await shareDashboard(dashboardId, [u.id]);
      if (!res.ok) return setError(res.error);
      setShared((s) => new Set(s).add(u.id));
      router.refresh();
    });
  }
  function remove(u: ShareUser) {
    setError(null);
    startTransition(async () => {
      const res = await unshareDashboard(dashboardId, u.id);
      if (!res.ok) return setError(res.error);
      setShared((s) => {
        const next = new Set(s);
        next.delete(u.id);
        return next;
      });
      router.refresh();
    });
  }
  function create() {
    setError(null);
    const days = expiry === "never" ? null : Number(expiry);
    const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
    startTransition(async () => {
      const res = await createShareLink(dashboardId, expiresAt);
      if (!res.ok) return setError(res.fieldErrors?.expiresAt ?? res.error);
      setCreatedUrl(res.data.url);
      setItems((l) => [
        { id: res.data.linkId, createdAt: new Date().toISOString(), expiresAt, status: "ativo" },
        ...l,
      ]);
      router.refresh();
    });
  }
  function revoke(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await revokeShareLink(id);
      if (!res.ok) return setError(res.error);
      setItems((l) => l.map((x) => (x.id === id ? { ...x, status: "revogado" } : x)));
      router.refresh();
    });
  }
  async function copy() {
    if (!createdUrl) return;
    try {
      await navigator.clipboard.writeText(createdUrl);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  }

  const tabCls = (t: Tab) =>
    `rounded-md px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      tab === t ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
    }`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          // A URL completa só existe enquanto o diálogo está aberto depois da criação.
          setCreatedUrl(null);
          setError(null);
          setQuery("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Compartilhar</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compartilhar dashboard</DialogTitle>
          <DialogDescription>
            Pessoas veem os números com o seu acesso, em modo de leitura. O link público mostra o mesmo, sem login.
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="Forma de compartilhar" className="flex gap-1">
          <button type="button" role="tab" id="tab-usuarios" aria-selected={tab === "usuarios"} aria-controls="painel-usuarios" className={tabCls("usuarios")} onClick={() => setTab("usuarios")}>
            Usuários
          </button>
          <button type="button" role="tab" id="tab-link" aria-selected={tab === "link"} aria-controls="painel-link" className={tabCls("link")} onClick={() => setTab("link")}>
            Link público
          </button>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {tab === "usuarios" ? (
          <div role="tabpanel" id="painel-usuarios" aria-labelledby="tab-usuarios" className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="share-search">Buscar pessoa</Label>
              <Input id="share-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome ou e-mail" />
            </div>
            <ul className="max-h-48 divide-y overflow-y-auto rounded-md border" aria-label="Pessoas disponíveis">
              {available.length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted-foreground">
                  {users.length === 0 ? "Não há outras pessoas nas suas empresas." : "Ninguém encontrado."}
                </li>
              ) : (
                available.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{u.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                    </span>
                    <Button size="sm" variant="outline" disabled={pending} aria-label={`Adicionar ${u.name}`} onClick={() => add(u)}>
                      Adicionar
                    </Button>
                  </li>
                ))
              )}
            </ul>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Com acesso</h3>
              <ul className="divide-y rounded-md border" aria-label="Pessoas com acesso">
                {withAccess.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground">Ninguém ainda.</li>
                ) : (
                  withAccess.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="truncate text-sm">{u.name}</span>
                      <Button size="sm" variant="ghost" disabled={pending} aria-label={`Remover ${u.name}`} onClick={() => remove(u)}>
                        Remover
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        ) : (
          <div role="tabpanel" id="painel-link" aria-labelledby="tab-link" className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="share-expiry">Expira em</Label>
                <select
                  id="share-expiry"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {EXPIRY.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button disabled={pending} onClick={create}>
                Criar link
              </Button>
            </div>

            {createdUrl ? (
              <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
                <Label htmlFor="share-url">URL do link</Label>
                <div className="flex gap-2">
                  <Input id="share-url" readOnly value={createdUrl} onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" onClick={copy}>
                    Copiar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Copie agora. Por segurança, esta URL não será mostrada de novo.</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Links criados</h3>
              <ul className="divide-y rounded-md border" aria-label="Links criados">
                {items.length === 0 ? (
                  <li className="px-3 py-3 text-sm text-muted-foreground">Nenhum link criado.</li>
                ) : (
                  items.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 text-sm">
                        <span className="block font-medium">{STATUS_LABEL[l.status]}</span>
                        <span className="block text-xs text-muted-foreground">
                          Criado em {fmtDate(l.createdAt)}
                          {" · "}
                          {l.expiresAt ? `Expira em ${fmtDate(l.expiresAt)}` : "Sem expiração"}
                        </span>
                      </span>
                      {l.status === "ativo" ? (
                        <Button size="sm" variant="outline" disabled={pending} aria-label={`Revogar link criado em ${fmtDate(l.createdAt)}`} onClick={() => revoke(l.id)}>
                          Revogar
                        </Button>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
