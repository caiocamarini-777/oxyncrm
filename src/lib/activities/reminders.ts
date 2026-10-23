/** Antecedência do lembrete; `minutes: null` = sem lembrete (valor guardado em `reminder_minutes`). */
export const REMINDER_OPTIONS = [
  { value: "none", label: "Sem lembrete", minutes: null },
  { value: "0", label: "Na hora", minutes: 0 },
  { value: "15", label: "15 minutos antes", minutes: 15 },
  { value: "30", label: "30 minutos antes", minutes: 30 },
  { value: "60", label: "1 hora antes", minutes: 60 },
  { value: "1440", label: "1 dia antes", minutes: 1440 },
] as const;

export type ReminderMinutes = (typeof REMINDER_OPTIONS)[number]["minutes"];

export const REMINDER_MINUTES: number[] = REMINDER_OPTIONS.flatMap((o) => (o.minutes === null ? [] : [o.minutes]));

export function reminderLabel(minutes: number | null | undefined): string {
  return REMINDER_OPTIONS.find((o) => o.minutes === (minutes ?? null))?.label ?? "Sem lembrete";
}
