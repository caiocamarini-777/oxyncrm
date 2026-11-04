"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPersonAndLink } from "@/lib/gmail/link-actions";

/** "Criar pessoa" a partir de um remetente que ainda não é contato; depois de criar, vincula a conversa a ela. */
export function CreatePersonFromSender({
  accountId,
  gmailThreadId,
  initialName,
  email,
}: {
  accountId: string;
  gmailThreadId: string;
  initialName: string;
  email: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [mail, setMail] = useState(email);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setName(initialName);
      setMail(email);
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await createPersonAndLink(accountId, gmailThreadId, name, mail);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data.linkError) toast.warning(`Pessoa criada, mas a conversa não foi vinculada: ${res.data.linkError}`);
      else toast.success("Pessoa criada e conversa vinculada.");
      setOpen(false);
      router.refresh();
    } catch {
      setError("Não foi possível criar a pessoa agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(true)}>
        <UserPlus /> Criar pessoa
        <span className="sr-only">: {email}</span>
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Criar pessoa</DialogTitle>
              <DialogDescription>O remetente ainda não é contato. A conversa será vinculada à nova pessoa.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sender-name">Nome</Label>
              <Input id="sender-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sender-email">E-mail</Label>
              <Input id="sender-email" type="email" value={mail} onChange={(e) => setMail(e.target.value)} required />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Criando…" : "Criar e vincular"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
