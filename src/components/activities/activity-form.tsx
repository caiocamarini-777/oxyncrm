"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PartyCombobox, type PartyValue } from "@/components/leads/party-combobox";
import { REMINDER_OPTIONS } from "@/lib/activities/reminders";
import type { AssignableOwner } from "@/lib/records/types";
import { cn } from "cn";
import { TypeIcon } from "./activity-chip";

export type FormType = { id: string; name: string; isMeeting: boolean };
export type FormChannel = { id: string; name: string };

export type FormValues = {
  typeId: string;
  channelId: string;
  subject: string;
  description: string;
  /** `YYYY-MM-DDTHH:mm` em São Paulo. */
  dueAt: string;
  durationMinutes: number;
  reminderMinutes: number | null;
  /** Só vem preenchido quando o usuário escolheu outro responsável. */
  ownerId?: string;
  /** `undefined` = não mexeu (a edição preserva o vínculo); `null` = removido. */
  person?: PartyValue | null;
  organization?: PartyValue | null;
};

export type FormInitial = {
  typeId?: string;
  channelId?: string;
  subject?: string;
  description?: string;
  dueAt: string;
  durationMinutes?: number;
  reminderMinutes?: number | null;
  ownerId: string;
  person?: PartyValue | null;
  organization?: PartyValue | null;
};

export type FormResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const selectClass =
  "h-8 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Formulário de atividade (criar, editar e próxima atividade). Quem usa decide a ação no `onSubmit`;
 * vínculos e responsável só saem quando o usuário mexeu, para a edição não apagar o que não enxerga.
 */
export function ActivityForm({
  idPrefix,
  companyId,
  types,
  channels,
  owners,
  canReassign,
  initial,
  parties,
  withDescription = true,
  submitLabel,
  cancelLabel,
  onCancel,
  onSubmit,
}: {
  idPrefix: string;
  companyId: string;
  types: FormType[];
  channels: FormChannel[];
  owners: AssignableOwner[];
  canReassign: boolean;
  initial: FormInitial;
  /** Quais vínculos relacionados o usuário pode ajustar. */
  parties: ("person" | "organization")[];
  withDescription?: boolean;
  submitLabel: string;
  cancelLabel?: string;
  onCancel?: () => void;
  onSubmit: (values: FormValues) => Promise<FormResult>;
}) {
  const [typeId, setTypeId] = useState(initial.typeId ?? types[0]?.id ?? "");
  const [channelId, setChannelId] = useState(initial.channelId ?? "");
  const [subject, setSubject] = useState(initial.subject ?? types.find((t) => t.id === (initial.typeId ?? types[0]?.id))?.name ?? "");
  const [subjectTouched, setSubjectTouched] = useState(Boolean(initial.subject));
  const [description, setDescription] = useState(initial.description ?? "");
  const [dueAt, setDueAt] = useState(initial.dueAt);
  const [duration, setDuration] = useState(String(initial.durationMinutes ?? 30));
  const [reminder, setReminder] = useState(initial.reminderMinutes == null ? "none" : String(initial.reminderMinutes));
  const [ownerId, setOwnerId] = useState(initial.ownerId);
  const [person, setPerson] = useState<PartyValue | null | undefined>(undefined);
  const [organization, setOrganization] = useState<PartyValue | null | undefined>(undefined);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const shownPerson = person === undefined ? (initial.person ?? null) : person;
  const shownOrg = organization === undefined ? (initial.organization ?? null) : organization;
  const durationNumber = Number(duration);
  const ready =
    Boolean(typeId && channelId && subject.trim() && dueAt) && duration.trim() !== "" && Number.isInteger(durationNumber);

  function pickType(t: FormType, previous: FormType | undefined) {
    setTypeId(t.id);
    if (!subjectTouched || subject === previous?.name) {
      setSubject(t.name);
      setSubjectTouched(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await onSubmit({
        typeId,
        channelId,
        subject: subject.trim(),
        description,
        dueAt,
        durationMinutes: durationNumber,
        reminderMinutes: reminder === "none" ? null : Number(reminder),
        ownerId: ownerId !== initial.ownerId ? ownerId : undefined,
        person,
        organization,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
      }
    } finally {
      setSaving(false);
    }
  }

  const currentType = types.find((t) => t.id === typeId);

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="activity-form">
      <div className="flex flex-col gap-1.5">
        <span id={`${idPrefix}-type-label`} className="text-sm font-medium">
          Tipo
        </span>
        <div role="radiogroup" aria-labelledby={`${idPrefix}-type-label`} className="flex flex-wrap gap-2">
          {types.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === typeId}
              onClick={() => pickType(t, currentType)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors",
                t.id === typeId ? "border-primary bg-primary/10 text-primary" : "border-input hover:bg-accent",
              )}
            >
              <TypeIcon name={t.name} isMeeting={t.isMeeting} />
              {t.name}
            </button>
          ))}
        </div>
        {errors.typeId ? <p role="alert" className="text-xs text-destructive">{errors.typeId}</p> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${idPrefix}-channel`} label="Canal" error={errors.channelId}>
          <select
            id={`${idPrefix}-channel`}
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className={selectClass}
          >
            <option value="">Escolha o canal</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${idPrefix}-subject`} label="Assunto" error={errors.subject}>
          <Input
            id={`${idPrefix}-subject`}
            value={subject}
            maxLength={200}
            onChange={(e) => {
              setSubject(e.target.value);
              setSubjectTouched(true);
            }}
          />
        </Field>
        <Field id={`${idPrefix}-due`} label="Data e hora" error={errors.dueAt}>
          <Input id={`${idPrefix}-due`} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </Field>
        <Field id={`${idPrefix}-duration`} label="Duração (minutos)" error={errors.durationMinutes}>
          <Input
            id={`${idPrefix}-duration`}
            type="number"
            min={0}
            max={1440}
            step={5}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <Field id={`${idPrefix}-reminder`} label="Lembrete" error={errors.reminderMinutes}>
          <select id={`${idPrefix}-reminder`} value={reminder} onChange={(e) => setReminder(e.target.value)} className={selectClass}>
            {REMINDER_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        {canReassign ? (
          <Field id={`${idPrefix}-owner`} label="Atribuída a" error={errors.ownerId}>
            <select
              id={`${idPrefix}-owner`}
              data-company={companyId}
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className={selectClass}
            >
              {owners
                .filter((o) => o.active || o.id === ownerId)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.fullName}
                    {o.active ? "" : " (inativo)"}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}
      </div>

      {withDescription ? (
        <Field id={`${idPrefix}-description`} label="Descrição" error={errors.description}>
          <Textarea
            id={`${idPrefix}-description`}
            rows={2}
            maxLength={5000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      ) : null}

      {parties.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {parties.includes("person") ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Pessoa relacionada</span>
              <PartyCombobox kind="person" companyId={companyId} value={shownPerson} onChange={setPerson} canCreate={false} />
            </div>
          ) : null}
          {parties.includes("organization") ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Organização relacionada</span>
              <PartyCombobox
                kind="organization"
                companyId={companyId}
                value={shownOrg}
                onChange={setOrganization}
                canCreate={false}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {errors.links ? <p role="alert" className="text-xs text-destructive">{errors.links}</p> : null}
      {formError && Object.keys(errors).length === 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
            {cancelLabel ?? "Cancelar"}
          </Button>
        ) : null}
        <Button type="submit" disabled={!ready || saving}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
