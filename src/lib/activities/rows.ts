type Rel<T> = T | T[] | null;

/** Embed do PostgREST pode vir como objeto ou lista de um item. */
function one<T>(v: Rel<T>): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

import type { MeetingOutcome } from "./schema";
import { dueStatus, type DueStatus } from "./time";

export type ActivityLink = { id: string; name: string };

export type ActivityRow = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  type: { id: string; name: string; isMeeting: boolean };
  channel: { id: string; name: string };
  subject: string;
  description: string | null;
  dueAt: string;
  durationMinutes: number;
  reminderMinutes: number | null;
  done: boolean;
  completedAt: string | null;
  outcome: { name: string; classification: "success" | "neutral" | "failure" } | null;
  meetingOutcome: MeetingOutcome | null;
  completionNote: string | null;
  ownerId: string;
  ownerName: string;
  /** Ids crus dos vínculos (inclusive os que o usuário não enxerga ou que estão na lixeira). */
  leadId: string | null;
  dealId: string | null;
  personId: string | null;
  organizationId: string | null;
  /** Só os vínculos que o usuário consegue ler e que não estão na lixeira. */
  lead: ActivityLink | null;
  deal: ActivityLink | null;
  person: ActivityLink | null;
  organization: ActivityLink | null;
  bookedByActivityId: string | null;
  legacy: boolean;
  status: DueStatus;
};

export const SELECT =
  "id, company_id, lead_id, deal_id, person_id, organization_id, subject, description, due_at, duration_minutes, reminder_minutes, done, completed_at, meeting_outcome, completion_note, owner_id, booked_by_activity_id, legacy, " +
  "company:companies(name, slug), type:activity_types(id, name, is_meeting), channel:activity_channels!channel_id(id, name), " +
  "outcome:activity_outcomes(name, classification), owner:profiles!owner_id(full_name), " +
  "lead:leads(id, title, deleted_at), deal:deals(id, title, deleted_at), person:persons(id, full_name, deleted_at), organization:organizations(id, name, deleted_at)";

export type RawRow = {
  id: string;
  company_id: string;
  lead_id: string | null;
  deal_id: string | null;
  person_id: string | null;
  organization_id: string | null;
  subject: string;
  description: string | null;
  due_at: string;
  duration_minutes: number;
  reminder_minutes: number | null;
  done: boolean;
  completed_at: string | null;
  meeting_outcome: MeetingOutcome | null;
  completion_note: string | null;
  owner_id: string;
  booked_by_activity_id: string | null;
  legacy: boolean;
  company: Rel<{ name: string; slug: string }>;
  type: Rel<{ id: string; name: string; is_meeting: boolean }>;
  channel: Rel<{ id: string; name: string }>;
  outcome: Rel<{ name: string; classification: "success" | "neutral" | "failure" }>;
  owner: Rel<{ full_name: string }>;
  lead: Rel<{ id: string; title: string; deleted_at: string | null }>;
  deal: Rel<{ id: string; title: string; deleted_at: string | null }>;
  person: Rel<{ id: string; full_name: string; deleted_at: string | null }>;
  organization: Rel<{ id: string; name: string; deleted_at: string | null }>;
};

function link<T extends { id: string; deleted_at: string | null }>(
  v: Rel<T>,
  name: (x: T) => string,
): ActivityLink | null {
  const x = one(v);
  return x && !x.deleted_at ? { id: x.id, name: name(x) } : null;
}

export function toActivityRow(r: RawRow, now: Date): ActivityRow {
  const type = one(r.type);
  const channel = one(r.channel);
  const outcome = one(r.outcome);
  return {
    id: r.id,
    companyId: r.company_id,
    companySlug: one(r.company)?.slug ?? "",
    companyName: one(r.company)?.name ?? "",
    type: { id: type?.id ?? "", name: type?.name ?? "", isMeeting: type?.is_meeting ?? false },
    channel: { id: channel?.id ?? "", name: channel?.name ?? "" },
    subject: r.subject,
    description: r.description,
    dueAt: r.due_at,
    durationMinutes: r.duration_minutes,
    reminderMinutes: r.reminder_minutes,
    done: r.done,
    completedAt: r.completed_at,
    outcome: outcome ? { name: outcome.name, classification: outcome.classification } : null,
    meetingOutcome: r.meeting_outcome,
    completionNote: r.completion_note,
    ownerId: r.owner_id,
    leadId: r.lead_id,
    dealId: r.deal_id,
    personId: r.person_id,
    organizationId: r.organization_id,
    ownerName: one(r.owner)?.full_name ?? "",
    lead: link(r.lead, (x) => x.title),
    deal: link(r.deal, (x) => x.title),
    person: link(r.person, (x) => x.full_name),
    organization: link(r.organization, (x) => x.name),
    bookedByActivityId: r.booked_by_activity_id,
    legacy: r.legacy,
    status: dueStatus(r.due_at, r.done, now),
  };
}

