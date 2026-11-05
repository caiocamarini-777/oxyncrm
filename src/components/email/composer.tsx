"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Mail, Reply } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseEmailList, replySubject, type ComposeMailbox, type ComposeTemplate } from "@/lib/gmail/compose";
import { sendEmail } from "@/lib/gmail/send";
import { renderTemplate } from "@/lib/gmail/template";
import type { RecordEntity } from "@/lib/records/types";

export type ComposerProps = {
  /** Texto do botão que abre o diálogo ("Novo e-mail", "Responder"). */
  label: string;
  /** Caixas do usuário que podem enviar. Vazio mostra o aviso para conectar. */
  mailboxes: ComposeMailbox[];
  templates: ComposeTemplate[];
  vars: Record<string, string>;
  /** Caixa pré-selecionada (a da conversa, numa resposta). */
  initialAccountId?: string;
  initialTo?: string[];
  initialSubject?: string;
  /** Resposta: a conversa e a mensagem a que se responde. */
  reply?: { gmailThreadId: string; replyToGmailMessageId: string };
  /** Card de onde o e-mail parte: o envio vincula a conversa a ele. */
  record?: { entity: RecordEntity; id: string };
};

type FormProps = Omit<ComposerProps, "label"> & { onDone: () => void; inline?: boolean };

function ComposerForm({
  mailboxes,
  templates,
  vars,
  initialAccountId,
  initialTo,
  initialSubject,
  reply,
  record,
  onDone,
  inline = false,
}: FormProps) {
  const router = useRouter();
  // O formulário da aba e o da resposta podem estar na tela ao mesmo tempo: ids próprios por instância.
  const uid = useId();
  const [accountId, setAccountId] = useState(
    mailboxes.find((m) => m.id === initialAccountId)?.id ?? mailboxes[0]?.id ?? "",
  );
  const [to, setTo] = useState((initialTo ?? []).join(", "));
  const [cc, setCc] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState(reply ? replySubject(initialSubject ?? "") : (initialSubject ?? ""));
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    // Numa resposta o assunto da conversa é mantido; o modelo só preenche o corpo.
    if (!reply && t.subject.trim()) setSubject(renderTemplate(t.subject, vars));
    setBody(renderTemplate(t.body, vars));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErrors({});
    setBusy(true);
    try {
      const res = await sendEmail({
        accountId,
        to: parseEmailList(to),
        cc: parseEmailList(cc),
        subject,
        body,
        gmailThreadId: reply?.gmailThreadId,
        replyToGmailMessageId: reply?.replyToGmailMessageId,
        record,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success("E-mail enviado.");
      if (res.data.warning) toast.warning(res.data.warning);
      onDone();
      router.refresh();
    } catch {
      toast.error("Não foi possível enviar agora. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const err = (field: string) =>
    errors[field] ? (
      <p role="alert" className="text-xs text-destructive">
        {errors[field]}
      </p>
    ) : null;

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
      {mailboxes.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-account`}>De</Label>
          <select
            id={`${uid}-account`}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email}
              </option>
            ))}
          </select>
          {err("accountId")}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">De: {mailboxes[0]?.email}</p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-to`}>Para</Label>
        <Input
          id={`${uid}-to`}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="nome@empresa.com, outro@empresa.com"
          aria-invalid={Boolean(errors.to)}
          autoComplete="off"
        />
        {err("to")}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-cc`}>Cc</Label>
        <Input
          id={`${uid}-cc`}
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          aria-invalid={Boolean(errors.cc)}
          autoComplete="off"
        />
        {err("cc")}
      </div>
      {templates.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${uid}-template`}>Modelo</Label>
          <select
            id={`${uid}-template`}
            value={templateId}
            onChange={(e) => applyTemplate(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Sem modelo</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-subject`}>Assunto</Label>
        <Input
          id={`${uid}-subject`}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          aria-invalid={Boolean(errors.subject)}
          autoComplete="off"
        />
        {err("subject")}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${uid}-body`}>Mensagem</Label>
        <Textarea
          id={`${uid}-body`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={Boolean(errors.body)}
          className={inline ? "min-h-32 max-h-96" : "min-h-48 max-h-96"}
        />
        {err("body")}
      </div>
      {inline ? (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
            Limpar
          </Button>
          <Button type="submit" disabled={busy || !accountId}>
            {busy ? "Enviando…" : "Enviar e-mail"}
          </Button>
        </div>
      ) : (
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !accountId}>
            {busy ? "Enviando…" : "Enviar"}
          </Button>
        </DialogFooter>
      )}
    </form>
  );
}

function NoMailbox() {
  return (
    <p className="text-sm text-muted-foreground">
      Você não tem uma caixa Gmail conectada e ativa nesta empresa. Conecte ou reconecte em{" "}
      <Link href="/perfil" className="text-primary underline underline-offset-2">
        Perfil
      </Link>
      .
    </p>
  );
}

/** Novo e-mail escrito direto na aba E-mail do card (como a aba Anotação). Enviar ou limpar recomeça o formulário. */
export function InlineComposer(props: Omit<ComposerProps, "label" | "reply">) {
  const [round, setRound] = useState(0);
  if (props.mailboxes.length === 0) return <NoMailbox />;
  return <ComposerForm key={round} {...props} inline onDone={() => setRound((r) => r + 1)} />;
}

/** Botão + diálogo para escrever e enviar um e-mail (novo ou resposta) pela caixa Gmail do usuário. */
export function Composer(props: ComposerProps) {
  const [open, setOpen] = useState(false);
  const Icon = props.reply ? Reply : Mail;
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Icon /> {props.label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{props.reply ? "Responder e-mail" : "Novo e-mail"}</DialogTitle>
            <DialogDescription>
              O texto vai como e-mail simples, com as quebras de linha. As variáveis do modelo são preenchidas com os dados do registro.
            </DialogDescription>
          </DialogHeader>
          {props.mailboxes.length === 0 ? (
            <NoMailbox />
          ) : (
            <ComposerForm {...props} onDone={() => setOpen(false)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
