"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TEMPLATE_VARIABLES } from "@/lib/gmail/compose";
import {
  createEmailTemplate,
  deleteEmailTemplate,
  setEmailSentAsActivity,
  updateEmailTemplate,
} from "@/lib/gmail/template-actions";

export type EmailTemplateRow = { id: string; name: string; subject: string; body: string };

type Draft = { id: string | null; name: string; subject: string; body: string };
const EMPTY: Draft = { id: null, name: "", subject: "", body: "" };

export function EmailTemplatesManager({
  companyId,
  templates,
  sentAsActivity,
}: {
  companyId: string;
  templates: EmailTemplateRow[];
  sentAsActivity: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setErrors({});
    setError(null);
    startTransition(async () => {
      const input = { name: draft.name, subject: draft.subject, body: draft.body };
      const res = draft.id ? await updateEmailTemplate(draft.id, input) : await createEmailTemplate(companyId, input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setError(res.error);
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  function remove(t: EmailTemplateRow) {
    if (!window.confirm(`Excluir o modelo "${t.name}"?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteEmailTemplate(t.id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  function toggleActivity(value: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setEmailSentAsActivity(companyId, value);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-md border p-3">
        <Switch
          id="email-sent-as-activity"
          checked={sentAsActivity}
          disabled={pending}
          onCheckedChange={toggleActivity}
        />
        <Label htmlFor="email-sent-as-activity" className="text-sm">
          E-mail enviado pelo CRM conta como atividade concluída
        </Label>
      </div>

      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium">Variáveis disponíveis</summary>
        <p className="mt-2 text-muted-foreground">
          Escreva a variável entre chaves duplas no assunto ou no texto. Quando o dado não existe no registro, ela fica vazia.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {TEMPLATE_VARIABLES.map((v) => (
            <li key={v.key}>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{`{{${v.key}}}`}</code>{" "}
              <span className="text-muted-foreground">{v.description}</span>
            </li>
          ))}
        </ul>
      </details>

      {error && !draft ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {draft ? (
        <form onSubmit={save} className="flex flex-col gap-3 rounded-md border p-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-name">Nome do modelo</Label>
            <Input
              id="tpl-name"
              value={draft.name}
              maxLength={120}
              aria-invalid={Boolean(errors.name)}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            {errors.name ? <p role="alert" className="text-xs text-destructive">{errors.name}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-subject">Assunto</Label>
            <Input
              id="tpl-subject"
              value={draft.subject}
              maxLength={300}
              aria-invalid={Boolean(errors.subject)}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
            {errors.subject ? <p role="alert" className="text-xs text-destructive">{errors.subject}</p> : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-body">Texto</Label>
            <Textarea
              id="tpl-body"
              value={draft.body}
              maxLength={20000}
              aria-invalid={Boolean(errors.body)}
              className="min-h-40"
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            {errors.body ? <p role="alert" className="text-xs text-destructive">{errors.body}</p> : null}
          </div>
          {error && !errors.name && !errors.subject && !errors.body ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {draft.id ? "Salvar" : "Criar modelo"}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setDraft(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button
            type="button"
            onClick={() => {
              setErrors({});
              setError(null);
              setDraft(EMPTY);
            }}
          >
            Novo modelo
          </Button>
        </div>
      )}

      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum modelo cadastrado.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {templates.map((t) => (
            <li key={t.id} data-testid="email-template-row" className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.name}</span>
                {t.subject ? <span className="block truncate text-xs text-muted-foreground">{t.subject}</span> : null}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label={`Editar ${t.name}`}
                  onClick={() => {
                    setErrors({});
                    setError(null);
                    setDraft({ id: t.id, name: t.name, subject: t.subject, body: t.body });
                  }}
                >
                  Editar
                </Button>
                <Button variant="ghost" size="sm" disabled={pending} aria-label={`Excluir ${t.name}`} onClick={() => remove(t)}>
                  Excluir
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
