"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/activities/time";
import { disconnectMailbox, setMailboxVisibility } from "@/lib/gmail/actions";
import { gmailErrorMessage } from "@/lib/gmail/connect";

export type MailboxView = {
  id: string;
  email: string;
  companyId: string;
  companyName: string;
  status: "active" | "reconnect";
  visibility: "shared" | "private";
  lastSyncedAt: string | null;
};

export type GmailFlash = { gmail: "ok" } | { gmail: "erro"; motivo: string | null } | null;

const connectUrl = (companyId: string) => `/api/google/conectar?empresa=${encodeURIComponent(companyId)}`;

export function EmailAccounts({
  accounts,
  companies,
  configured,
  flash,
}: {
  accounts: MailboxView[];
  companies: { id: string; name: string }[];
  configured: boolean;
  flash: GmailFlash;
}) {
  const router = useRouter();
  const shown = useRef(false);

  // Avisa o resultado da volta do Google e limpa os parâmetros da URL.
  useEffect(() => {
    if (!flash || shown.current) return;
    shown.current = true;
    if (flash.gmail === "ok") toast.success("Gmail conectado.");
    else toast.error(gmailErrorMessage(flash.motivo));
    router.replace("/perfil");
  }, [flash, router]);

  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">E-mail</CardTitle>
        <CardDescription>
          Conecte sua caixa do Gmail para ver as conversas dentro dos cards e enviar e-mails pelo CRM.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!configured ? (
          <p className="text-sm text-muted-foreground">Integração com o Gmail ainda não configurada.</p>
        ) : (
          <>
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma caixa conectada.</p>
            ) : (
              <ul className="grid gap-3">
                {accounts.map((a) => (
                  <MailboxItem key={a.id} account={a} />
                ))}
              </ul>
            )}
            {companies.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger className="w-56" aria-label="Empresa da caixa">
                    <SelectValue placeholder="Empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button asChild variant="outline">
                  <a href={connectUrl(companyId)}>Conectar Gmail</a>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Você não tem acesso a nenhuma empresa para conectar uma caixa.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MailboxItem({ account }: { account: MailboxView }) {
  const [pending, start] = useTransition();
  const [visibility, setVisibility] = useState(account.visibility);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function changeVisibility(next: string) {
    if (next !== "shared" && next !== "private") return;
    const previous = visibility;
    setVisibility(next);
    start(async () => {
      const r = await setMailboxVisibility(account.id, next);
      if (!r.ok) {
        setVisibility(previous);
        toast.error(r.error);
        return;
      }
      toast.success("Visibilidade atualizada.");
    });
  }

  function disconnect() {
    start(async () => {
      const r = await disconnectMailbox(account.id);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Caixa desconectada.");
    });
  }

  return (
    <li className="grid gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{account.email}</span>
        <Badge variant="secondary">{account.companyName}</Badge>
        {account.status === "reconnect" ? <Badge variant="destructive">Reconectar</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {account.lastSyncedAt
          ? `Última sincronização: ${formatDateTime(account.lastSyncedAt)}`
          : "Aguardando primeira sincronização"}
      </p>
      {account.status === "reconnect" ? (
        <div className="grid gap-2">
          <p role="alert" className="text-sm text-destructive">
            O Google encerrou o acesso a esta caixa. Reconecte para voltar a sincronizar.
          </p>
          <div>
            <Button asChild size="sm">
              <a href={connectUrl(account.companyId)}>Reconectar</a>
            </Button>
          </div>
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <Select value={visibility} onValueChange={changeVisibility} disabled={pending}>
          <SelectTrigger className="w-56" aria-label="Visibilidade da caixa">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shared">Compartilhada</SelectItem>
            <SelectItem value="private">Privada</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {visibility === "shared"
            ? "Compartilhada: quem tem acesso a um card vê as conversas desta caixa vinculadas a ele."
            : "Privada: só você vê as conversas desta caixa, mesmo nos cards compartilhados."}
        </p>
      </div>
      <div>
        <Button variant="destructive" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)}>
          Desconectar
        </Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar {account.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              O acesso ao Gmail é revogado e as conversas desta caixa salvas no CRM são apagadas. Seus e-mails no Gmail não
              são afetados. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={disconnect}>Desconectar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
