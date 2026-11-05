/**
 * Casador de vínculo da reunião (puro, sem banco): dados os candidatos já carregados
 * (pessoas com seus negócios, leads e reuniões agendadas), escolhe o registro onde as
 * notas vão ser gravadas. Regras na spec, seção "Vincular".
 */

/** Janela da reunião agendada que vira âncora: até 1 dia para mais ou para menos. */
const ANCHOR_WINDOW_MS = 24 * 3600_000;

export type MeetingActivity = {
  /** Id da atividade no CRM (uuid). É ele que vira `anchor_activity_id`. */
  id: string;
  dealId: string | null;
  leadId: string | null;
  personId: string | null;
  dueAt: string;
  /** Id da mesma atividade no Pipedrive (via `external_ids`), para as tarefas que gravam lá. */
  pipedriveId: string | null;
};

export type Candidate = {
  person: { id: string; organizationId: string | null };
  /** Negócios abertos da pessoa ou da organização dela. */
  deals: { id: string; personId: string | null; organizationId: string | null; lastActivityAt: string | null }[];
  /** Leads abertos da pessoa ou da organização dela. */
  leads: { id: string; personId: string | null; organizationId: string | null }[];
  /** Reuniões agendadas (não concluídas) desses registros. */
  meetingActivities: MeetingActivity[];
};

export type PickedRecord = {
  entity: "deals" | "leads" | "persons";
  recordId: string;
  anchorActivityId: string | null;
};

/** E-mail comparável: sem espaços nas pontas e em minúsculas. */
export function normalizeEmail(e: string): string {
  return e.trim().toLowerCase();
}

/**
 * Separa os convidados em externos e internos pelo domínio (`internalDomains` em minúsculas).
 * Normaliza, descarta vazios e repetidos, e mantém a ordem de chegada.
 */
export function splitAttendees(
  emails: string[],
  internalDomains: Set<string>,
): { external: string[]; internal: string[] } {
  const external: string[] = [];
  const internal: string[] = [];
  const seen = new Set<string>();
  for (const raw of emails) {
    const email = normalizeEmail(raw);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const at = email.lastIndexOf("@");
    const domain = at < 0 ? "" : email.slice(at + 1);
    (domain && internalDomains.has(domain) ? internal : external).push(email);
  }
  return { external, internal };
}

type Nearest = { activity: MeetingActivity; distance: number };

/** A reunião mais perto do horário, dentro da janela de ±1 dia (ou null). */
function nearestMeeting(activities: MeetingActivity[], meetingAt: Date): Nearest | null {
  let best: Nearest | null = null;
  for (const activity of activities) {
    const due = new Date(activity.dueAt).getTime();
    if (Number.isNaN(due)) continue;
    const distance = Math.abs(due - meetingAt.getTime());
    if (distance > ANCHOR_WINDOW_MS) continue;
    if (!best || distance < best.distance) best = { activity, distance };
  }
  return best;
}

/**
 * Entre vários itens do mesmo tipo, fica com os que têm a reunião agendada mais perto.
 * Se nenhum tem reunião na janela, devolve todos (nada a desempatar por este critério).
 */
function narrowByAnchor<T>(items: T[], anchorOf: (item: T) => Nearest | null): T[] {
  let min = Infinity;
  for (const item of items) {
    const n = anchorOf(item);
    if (n && n.distance < min) min = n.distance;
  }
  if (min === Infinity) return items;
  return items.filter((item) => anchorOf(item)?.distance === min);
}

/** Dedupe por id, mantendo a primeira ocorrência. */
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/**
 * Escolhe o registro da reunião, na ordem da spec:
 * 1. negócio aberto; vários: a reunião agendada mais perto (até ±1 dia), depois a atividade mais recente;
 * 2. sem negócio, lead aberto (vários: a reunião agendada mais perto);
 * 3. sem lead, a própria pessoa (várias: a reunião agendada mais perto).
 * Empate sem critério, ou nenhum candidato, dá null (a reunião fica "sem vínculo").
 */
export function pickRecord(c: Candidate[], meetingAt: Date): PickedRecord | null {
  if (c.length === 0) return null;

  const activities = uniqueById(c.flatMap((x) => x.meetingActivities));

  // 1. Negócio aberto.
  const deals = uniqueById(c.flatMap((x) => x.deals));
  if (deals.length > 0) {
    const anchorOf = (d: { id: string }) =>
      nearestMeeting(
        activities.filter((a) => a.dealId === d.id),
        meetingAt,
      );
    let pool = narrowByAnchor(deals, anchorOf);
    if (pool.length > 1) {
      // Desempate pela atividade mais recente do negócio. Sem data ou empatado: sem critério.
      const stamp = (d: { lastActivityAt: string | null }) => (d.lastActivityAt ? new Date(d.lastActivityAt).getTime() : NaN);
      const max = Math.max(...pool.map((d) => (Number.isNaN(stamp(d)) ? -Infinity : stamp(d))));
      if (max === -Infinity) return null;
      pool = pool.filter((d) => stamp(d) === max);
      if (pool.length > 1) return null;
    }
    const chosen = pool[0];
    return { entity: "deals", recordId: chosen.id, anchorActivityId: anchorOf(chosen)?.activity.id ?? null };
  }

  // 2. Lead aberto.
  const leads = uniqueById(c.flatMap((x) => x.leads));
  if (leads.length > 0) {
    const anchorOf = (l: { id: string }) =>
      nearestMeeting(
        activities.filter((a) => a.leadId === l.id),
        meetingAt,
      );
    const pool = narrowByAnchor(leads, anchorOf);
    if (pool.length > 1) return null;
    return { entity: "leads", recordId: pool[0].id, anchorActivityId: anchorOf(pool[0])?.activity.id ?? null };
  }

  // 3. A própria pessoa. A âncora é uma reunião dela que não pertence a negócio nem a lead.
  const persons = uniqueById(c.map((x) => x.person));
  const anchorOf = (p: { id: string }) =>
    nearestMeeting(
      activities.filter((a) => a.personId === p.id && !a.dealId && !a.leadId),
      meetingAt,
    );
  const pool = narrowByAnchor(persons, anchorOf);
  if (pool.length > 1) return null;
  return { entity: "persons", recordId: pool[0].id, anchorActivityId: anchorOf(pool[0])?.activity.id ?? null };
}
