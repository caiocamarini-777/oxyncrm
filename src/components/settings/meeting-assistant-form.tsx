"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_QUESTIONS, MAX_QUESTION_LENGTH, MAX_QUESTIONS } from "@/lib/meet/settings";
import { saveMeetingSettings } from "@/lib/meet/settings-actions";

/** Cada pergunta tem um id estável, para o campo não perder o foco ao reordenar ou remover. */
type Item = { id: number; text: string };

/**
 * Configuração do assistente de reuniões de uma empresa: liga/desliga e roteiro de perguntas. As perguntas
 * já chegam preenchidas (roteiro padrão quando a empresa ainda não editou). O que vale é o que foi salvo.
 */
export function MeetingAssistantForm({
  companyId,
  enabled: initialEnabled,
  questions: initialQuestions,
}: {
  companyId: string;
  enabled: boolean;
  questions: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const nextId = useRef(initialQuestions.length);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [items, setItems] = useState<Item[]>(() => initialQuestions.map((text, id) => ({ id, text })));
  const [error, setError] = useState<string | null>(null);

  const dirty =
    enabled !== initialEnabled ||
    items.length !== initialQuestions.length ||
    items.some((it, i) => it.text !== initialQuestions[i]);

  function setText(id: number, text: string) {
    setItems((cur) => cur.map((it) => (it.id === id ? { ...it, text } : it)));
  }

  function move(index: number, delta: -1 | 1) {
    setItems((cur) => {
      const to = index + delta;
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  function add() {
    setItems((cur) => (cur.length >= MAX_QUESTIONS ? cur : [...cur, { id: nextId.current++, text: "" }]));
  }

  function restoreDefaults() {
    setItems(DEFAULT_QUESTIONS.map((text) => ({ id: nextId.current++, text })));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await saveMeetingSettings(companyId, { enabled, questions: items.map((it) => it.text) });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // O servidor grava as perguntas aparadas; espelha isso aqui para o formulário voltar a "sem alterações".
      setItems((cur) => cur.map((it) => ({ ...it, text: it.text.trim() })));
      toast.success("Configurações salvas.");
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      <div className="flex items-start gap-3 rounded-md border p-3">
        <Switch id="meeting-assistant-enabled" checked={enabled} disabled={pending} onCheckedChange={setEnabled} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="meeting-assistant-enabled" className="text-sm">
            Assistente de reuniões ligado
          </Label>
          <p className="text-xs text-muted-foreground">
            Lê a transcrição (ou, sem ela, as anotações do Gemini) das reuniões do Google Meet com convidado externo,
            gera as notas e sugere os próximos passos para o vendedor confirmar. Desligado, nada das reuniões desta
            empresa é lido.
          </p>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border p-3" disabled={pending}>
        <legend className="px-1 text-sm font-medium">Roteiro de qualificação</legend>
        <p className="text-xs text-muted-foreground">
          O assistente responde estas perguntas, na ordem, a partir do que foi dito na reunião. De 1 a {MAX_QUESTIONS}{" "}
          perguntas, com até {MAX_QUESTION_LENGTH} caracteres cada.
        </p>
        <ol className="flex flex-col gap-2">
          {items.map((it, i) => (
            <li key={it.id} data-testid="meeting-question-row" className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-sm text-muted-foreground">{i + 1}.</span>
              <Input
                value={it.text}
                maxLength={MAX_QUESTION_LENGTH}
                aria-label={`Pergunta ${i + 1}`}
                aria-invalid={error !== null && it.text.trim() === ""}
                onChange={(e) => setText(it.id, e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Subir a pergunta ${i + 1}`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUpIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Descer a pergunta ${i + 1}`}
                disabled={i === items.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDownIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remover a pergunta ${i + 1}`}
                onClick={() => setItems((cur) => cur.filter((x) => x.id !== it.id))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ol>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma pergunta. Adicione pelo menos uma para salvar.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={items.length >= MAX_QUESTIONS} onClick={add}>
            <PlusIcon /> Adicionar pergunta
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={restoreDefaults}>
            Restaurar roteiro padrão
          </Button>
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
