"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CLASSIFICATIONS,
  CLASSIFICATION_LABELS,
  LEAD_RULE_LABELS,
  type ActivityConfigKind,
  type Classification,
  type LeadRule,
} from "@/lib/activities/settings-schema";
import {
  createActivityConfig,
  setLeadNextActivityRule,
  setTypeMeeting,
  updateOutcome,
} from "@/lib/activities/settings-actions";
import { moveListItem, renameListItem, setListItemActive } from "@/lib/lists/actions";
import { NEXT_ACTIVITY_RULES } from "@/lib/pipelines/schema";

export type TypeRow = { id: string; name: string; active: boolean; isMeeting: boolean };
export type ChannelRow = { id: string; name: string; active: boolean; isLegacy: boolean };
export type OutcomeRow = {
  id: string;
  name: string;
  active: boolean;
  classification: Classification;
  booksMeeting: boolean;
};

type Result = { ok: boolean; error?: string; fieldErrors?: Record<string, string> };

function useRunner() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<Result>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.fieldErrors?.name ?? result.error ?? "Não foi possível concluir. Tente novamente.");
      else onOk?.();
      router.refresh();
    });
  }
  return { pending, error, run };
}

function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-md border p-4" aria-label={title}>
      <div>
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Row({
  testId,
  kind,
  item,
  index,
  total,
  pending,
  run,
  legacy,
  children,
}: {
  testId: string;
  kind: ActivityConfigKind;
  item: { id: string; name: string; active: boolean };
  index: number;
  total: number;
  pending: boolean;
  run: ReturnType<typeof useRunner>["run"];
  legacy?: boolean;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  return (
    <li data-testid={testId} data-active={item.active} className="flex flex-wrap items-center gap-3 px-3 py-2">
      {editing ? (
        <>
          <Input aria-label={`Novo nome de ${item.name}`} value={name} onChange={(e) => setName(e.target.value)} className="w-64" />
          <Button size="sm" disabled={pending} onClick={() => run(() => renameListItem(kind, item.id, name), () => setEditing(false))}>
            Salvar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </>
      ) : (
        <>
          <span className={"min-w-0 flex-1 truncate " + (item.active ? "font-medium" : "text-muted-foreground")}>
            {item.name}
            {legacy ? <Badge variant="outline" className="ml-2">Importação</Badge> : null}
            {item.active ? null : <Badge variant="outline" className="ml-2">Inativo</Badge>}
          </span>
          {children}
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" disabled={pending || index === 0} aria-label={`Subir ${item.name}`} onClick={() => run(() => moveListItem(kind, item.id, "up"))}>
              Subir
            </Button>
            <Button variant="ghost" size="sm" disabled={pending || index === total - 1} aria-label={`Descer ${item.name}`} onClick={() => run(() => moveListItem(kind, item.id, "down"))}>
              Descer
            </Button>
            {legacy ? null : (
              <>
                <Button variant="outline" size="sm" onClick={() => { setName(item.name); setEditing(true); }}>
                  Renomear
                </Button>
                <Button variant="outline" size="sm" disabled={pending} aria-label={`${item.active ? "Desativar" : "Ativar"} ${item.name}`} onClick={() => run(() => setListItemActive(kind, item.id, !item.active))}>
                  {item.active ? "Desativar" : "Ativar"}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function CreateForm({
  label,
  id,
  name,
  setName,
  pending,
  onSubmit,
  children,
}: {
  label: string;
  id: string;
  name: string;
  setName: (v: string) => void;
  pending: boolean;
  onSubmit: () => void;
  children?: React.ReactNode;
}) {
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input id={id} value={name} onChange={(e) => setName(e.target.value)} className="w-64" />
      </div>
      {children}
      <Button type="submit" disabled={pending}>
        Adicionar
      </Button>
    </form>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

function TypesBlock({ companyId, items }: { companyId: string; items: TypeRow[] }) {
  const { pending, error, run } = useRunner();
  const [name, setName] = useState("");
  const [isMeeting, setIsMeeting] = useState(false);
  return (
    <Block title="Tipos" hint="Tipos inativos somem dos formulários e continuam nas atividades existentes.">
      <CreateForm
        label="Novo tipo"
        id="new-type"
        name={name}
        setName={setName}
        pending={pending}
        onSubmit={() =>
          run(
            () => createActivityConfig(companyId, { kind: "activity_type", name, isMeeting }),
            () => { setName(""); setIsMeeting(false); },
          )
        }
      >
        <div className="flex items-center gap-2 pb-2">
          <Switch id="new-type-meeting" checked={isMeeting} onCheckedChange={setIsMeeting} />
          <Label htmlFor="new-type-meeting">É reunião</Label>
        </div>
      </CreateForm>
      <ErrorLine error={error} />
      <ul className="divide-y rounded-md border">
        {items.map((it, i) => (
          <Row key={it.id} testId="type-row" kind="activity_type" item={it} index={i} total={items.length} pending={pending} run={run}>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={it.isMeeting}
                disabled={pending}
                aria-label={`É reunião: ${it.name}`}
                onCheckedChange={(v) => run(() => setTypeMeeting(it.id, v))}
              />
              É reunião
            </label>
          </Row>
        ))}
      </ul>
    </Block>
  );
}

function ChannelsBlock({ companyId, items }: { companyId: string; items: ChannelRow[] }) {
  const { pending, error, run } = useRunner();
  const [name, setName] = useState("");
  return (
    <Block title="Canais" hint="Canais inativos somem dos formulários e continuam nas atividades existentes.">
      <CreateForm
        label="Novo canal"
        id="new-channel"
        name={name}
        setName={setName}
        pending={pending}
        onSubmit={() => run(() => createActivityConfig(companyId, { kind: "activity_channel", name }), () => setName(""))}
      />
      <ErrorLine error={error} />
      <ul className="divide-y rounded-md border">
        {items.map((it, i) => (
          <Row key={it.id} testId="channel-row" kind="activity_channel" item={it} index={i} total={items.length} pending={pending} run={run} legacy={it.isLegacy} />
        ))}
      </ul>
    </Block>
  );
}

function OutcomesBlock({ companyId, items }: { companyId: string; items: OutcomeRow[] }) {
  const { pending, error, run } = useRunner();
  const [name, setName] = useState("");
  const [classification, setClassification] = useState<Classification>("neutral");
  const [booksMeeting, setBooksMeeting] = useState(false);
  return (
    <Block title="Resultados" hint="Todo resultado tem uma classificação. Os que agendam reunião pedem os dados da reunião.">
      <CreateForm
        label="Novo resultado"
        id="new-outcome"
        name={name}
        setName={setName}
        pending={pending}
        onSubmit={() =>
          run(
            () => createActivityConfig(companyId, { kind: "activity_outcome", name, classification, booksMeeting }),
            () => { setName(""); setClassification("neutral"); setBooksMeeting(false); },
          )
        }
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-outcome-class">Classificação</Label>
          <select
            id="new-outcome-class"
            value={classification}
            onChange={(e) => setClassification(e.target.value as Classification)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          >
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>{CLASSIFICATION_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="new-outcome-books" checked={booksMeeting} onCheckedChange={setBooksMeeting} />
          <Label htmlFor="new-outcome-books">Agenda reunião</Label>
        </div>
      </CreateForm>
      <ErrorLine error={error} />
      <ul className="divide-y rounded-md border">
        {items.map((it, i) => (
          <Row key={it.id} testId="outcome-row" kind="activity_outcome" item={it} index={i} total={items.length} pending={pending} run={run}>
            <select
              aria-label={`Classificação de ${it.name}`}
              value={it.classification}
              disabled={pending}
              onChange={(e) => run(() => updateOutcome(it.id, { classification: e.target.value }))}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>{CLASSIFICATION_LABELS[c]}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={it.booksMeeting}
                disabled={pending}
                aria-label={`Agenda reunião: ${it.name}`}
                onCheckedChange={(v) => run(() => updateOutcome(it.id, { booksMeeting: v }))}
              />
              Agenda reunião
            </label>
          </Row>
        ))}
      </ul>
    </Block>
  );
}

function LeadRuleBlock({ companyId, rule }: { companyId: string; rule: LeadRule }) {
  const { pending, error, run } = useRunner();
  const [value, setValue] = useState(rule);
  const [prev, setPrev] = useState(rule);
  if (prev !== rule) {
    setPrev(rule);
    setValue(rule);
  }
  return (
    <Block title="Regra de próxima atividade para leads" hint="Define se, ao concluir uma atividade de um lead, o sistema sugere ou exige a próxima.">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="lead-rule">Regra</Label>
        <select
          id="lead-rule"
          value={value}
          disabled={pending}
          onChange={(e) => {
            setValue(e.target.value as LeadRule);
            run(() => setLeadNextActivityRule(companyId, e.target.value));
          }}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          {NEXT_ACTIVITY_RULES.map((r) => (
            <option key={r} value={r}>{LEAD_RULE_LABELS[r]}</option>
          ))}
        </select>
      </div>
      <ErrorLine error={error} />
    </Block>
  );
}

export function ActivitySettingsManager({
  companyId,
  types,
  channels,
  outcomes,
  leadRule,
}: {
  companyId: string;
  types: TypeRow[];
  channels: ChannelRow[];
  outcomes: OutcomeRow[];
  leadRule: LeadRule;
}) {
  return (
    <div className="flex flex-col gap-6">
      <TypesBlock companyId={companyId} items={types} />
      <ChannelsBlock companyId={companyId} items={channels} />
      <OutcomesBlock companyId={companyId} items={outcomes} />
      <LeadRuleBlock companyId={companyId} rule={leadRule} />
    </div>
  );
}
