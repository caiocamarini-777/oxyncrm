/**
 * Conversões CRM → Pipedrive (API v1), ao contrário de `src/lib/import/mapping.ts`. Funções puras: recebem a linha
 * do CRM, lida com `PUSH_SELECT`, e devolvem o caminho da coleção e o corpo. Quem envia decide entre o POST no
 * caminho (registro sem id no Pipedrive) e o PUT/PATCH em `${path}/{id}`.
 *
 * Vai só o que o Pipedrive tem campo para receber (spec "O que vai e o que não vai"). Campo vazio no CRM vai null
 * para limpar o Pipedrive. Dono sem usuário no Pipedrive fica de fora, e o Pipedrive usa o usuário do token.
 */

export type PushEntity = "organizations" | "persons" | "leads" | "deals" | "activities" | "notes";

export type PushCtx = {
  pdUserOf(profileId: string | null): number | null; // mapa de usuários ao contrário; null → usuário do token
  pdIdOf(entity: PushEntity, crmId: string | null): string | null; // external_ids
  pdStageOf(stageId: string): number | null; // etapa CRM → etapa Pipedrive
  pdLeadLabelOf(companyId: string): string | null; // empresa → etiqueta de lead
  /**
   * Ao contrário do mapa da importação. `crmKey` é a chave em `custom_fields` ou `native:<coluna>` (setup_total, mrr,
   * contract_months). `type` é o tipo do campo no Pipedrive ou no CRM. `options`: rótulo da opção → id no Pipedrive.
   */
  customFields: { crmKey: string; pdKey: string; type: string; options?: Record<string, string> }[];
  pdActivityTypeOf(typeName: string, isMeeting: boolean): string; // tipo do CRM → key do tipo no Pipedrive (fallback "meeting"/"task")
  /**
   * Resultado da reunião → opção do campo `outcome`. Recebe o rótulo da opção no Pipedrive, já convertido do CRM
   * (ex.: "Concluída qualificada", "Não compareceu"); o store compara sem acento e sem maiúsculas.
   */
  pdOutcomeOf(meetingOutcome: string | null): number | null;
};

export type PushPayload = { path: string; body: Record<string, unknown> } | { error: string };

/** Colunas que o store lê de cada tabela: além da linha, o nome do motivo de perda e o tipo e o resultado da atividade. */
export const PUSH_SELECT: Record<PushEntity, string> = {
  organizations: "*",
  persons: "*",
  leads: "*",
  deals: "*, lost_reason:lost_reasons(name)",
  activities: "*, activity_type:activity_types(name, is_meeting), outcome:activity_outcomes(name)",
  notes: "*",
};

type Row = Record<string, unknown>;
type Fail = { error: string };

const fail = (error: string): Fail => ({ error });
const isFail = (v: unknown): v is Fail => typeof v === "object" && v !== null && "error" in v;

const PATHS: Record<PushEntity, string> = {
  organizations: "/v1/organizations",
  persons: "/v1/persons",
  leads: "/v1/leads",
  deals: "/v1/deals",
  activities: "/v1/activities",
  notes: "/v1/notes",
};

const NAMES: Record<PushEntity, string> = {
  organizations: "organização",
  persons: "pessoa",
  leads: "lead",
  deals: "negócio",
  activities: "atividade",
  notes: "anotação",
};

/** O CRM só trabalha em reais. */
const CURRENCY = "BRL";

// ---- leitura defensiva ---------------------------------------------------------------------------------------

function str(v: unknown): string | null {
  if (typeof v !== "string") return typeof v === "number" ? String(v) : null;
  const t = v.trim();
  return t === "" ? null : t;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function dateOnly(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** Nome de um relacionamento embutido (`{ name }`, de `PUSH_SELECT`) ou o próprio texto. */
function nameOf(v: unknown): string | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return str((v as Row).name);
  return str(v);
}

/** Ids do Pipedrive são números, exceto os de lead (uuid). */
function pdNumber(id: string): number | string {
  return /^\d+$/.test(id) ? Number(id) : id;
}

/** Id do relacionado no Pipedrive: null sem vínculo no CRM; erro quando o relacionado ainda não foi criado lá. */
function pdRef(entity: PushEntity, crmId: unknown, ctx: PushCtx): number | string | null | Fail {
  const id = str(crmId);
  if (!id) return null;
  const pd = ctx.pdIdOf(entity, id);
  if (!pd) return fail(`${NAMES[entity]} ainda sem id no Pipedrive`);
  return entity === "leads" ? pd : pdNumber(pd);
}

/** Dono pelo mapa de usuários; sem usuário no Pipedrive a chave fica de fora. */
function owner(key: string, profileId: unknown, ctx: PushCtx): Row {
  const user = ctx.pdUserOf(str(profileId));
  return user === null ? {} : { [key]: user };
}

// ---- formatos ------------------------------------------------------------------------------------------------

/** Endereço do CRM ({ street, number, city, state, zip }) em uma linha; a importação guarda o texto do Pipedrive na rua. */
function addressText(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (!v || typeof v !== "object") return null;
  const a = v as Row;
  const parts = [a.street, a.number, a.city, a.state, a.zip].map(str).filter((p): p is string => !!p);
  return parts.length ? parts.join(", ") : null;
}

// Rótulo do CRM (ou o do Pipedrive, guardado como veio na importação) -> rótulo do Pipedrive
const EMAIL_LABELS: Record<string, string> = {
  trabalho: "work",
  work: "work",
  pessoal: "home",
  home: "home",
  outro: "other",
  other: "other",
};
const PHONE_LABELS: Record<string, string> = { ...EMAIL_LABELS, celular: "mobile", mobile: "mobile" };

/** Lista de contatos do CRM no formato do Pipedrive; o primeiro é o principal, como na tela do CRM. */
function pdContacts(v: unknown, labels: Record<string, string>): Row[] {
  if (!Array.isArray(v)) return [];
  const out: Row[] = [];
  for (const e of v) {
    const o: Row = e && typeof e === "object" ? (e as Row) : { value: e };
    const value = str(o.value);
    if (!value) continue;
    const label = str(o.label);
    out.push({ value, primary: out.length === 0, label: label ? (labels[norm(label)] ?? "other") : "work" });
  }
  return out;
}

// Mesmo teste de `noteText` (src/lib/timeline/describe.ts): corpo importado do Pipedrive já vem em HTML.
const HTML_TAG = /<\/?[a-z][^>]*>/i;

/** Texto do CRM no HTML que o Pipedrive mostra nas anotações e nas notas de atividade. */
function pdHtml(text: string): string {
  if (HTML_TAG.test(text)) return text;
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
}

/** timestamptz -> data e hora (HH:MM) em UTC, o inverso de `dueAt`. */
function utcParts(v: unknown): { date: string; time: string } | null {
  const s = str(v);
  if (!s) return null;
  // aceita também o formato de texto do Postgres ("2026-11-12 15:00:00+00")
  const d = new Date(s.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Minutos -> "HH:MM"; zero ou vazio: null (o inverso de `durationMinutes`). */
function hhmm(v: unknown): string | null {
  const n = num(v);
  if (n === null || n <= 0) return null;
  const m = Math.min(1440, Math.round(n));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---- campos personalizados -----------------------------------------------------------------------------------

type CustomField = PushCtx["customFields"][number];

function optionId(label: unknown, options: Record<string, string> | undefined): string | null {
  const l = str(label);
  if (!l || !options) return null;
  if (options[l] !== undefined) return options[l];
  const key = norm(l);
  const hit = Object.entries(options).find(([name]) => norm(name) === key);
  return hit ? hit[1] : null;
}

/** Valor no formato do Pipedrive; undefined deixa o campo de fora (opção ou usuário sem correspondente). */
function customValue(raw: unknown, f: CustomField, ctx: PushCtx): unknown {
  if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) return null;
  switch (f.type) {
    case "enum":
    case "select": {
      const id = optionId(Array.isArray(raw) ? raw[0] : raw, f.options);
      return id === null ? undefined : pdNumber(id);
    }
    case "set":
    case "multiselect": {
      const ids = (Array.isArray(raw) ? raw : [raw]).map((l) => optionId(l, f.options)).filter((id): id is string => id !== null);
      return ids.length ? ids.join(",") : undefined;
    }
    case "user":
      return ctx.pdUserOf(str(raw)) ?? undefined;
    case "double":
    case "int":
    case "monetary":
    case "number":
    case "money":
      return num(raw) ?? undefined;
    case "date":
      return dateOnly(raw) ?? undefined;
    default:
      if (Array.isArray(raw)) return raw.map(str).filter((x): x is string => !!x).join(", ") || null;
      return str(raw);
  }
}

/** Campos personalizados do negócio pelo mapa da importação ao contrário (o inverso de `applyCustom`). */
function pdCustom(row: Row, ctx: PushCtx): Row {
  const custom = (row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {}) as Row;
  const out: Row = {};
  for (const f of ctx.customFields) {
    let v: unknown;
    if (f.crmKey === "native:setup_total" || f.crmKey === "native:mrr") {
      // a importação grava 0 quando o campo vem vazio: 0 volta vazio
      const n = num(row[f.crmKey.slice(7)]);
      v = n !== null && n > 0 ? n : null;
    } else if (f.crmKey === "native:contract_months") {
      v = num(row.contract_months);
    } else if (f.crmKey.startsWith("native:")) {
      continue;
    } else {
      v = customValue(custom[f.crmKey], f, ctx);
    }
    if (v !== undefined) out[f.pdKey] = v;
  }
  return out;
}

// ---- resultado da atividade ----------------------------------------------------------------------------------

// Desfecho da reunião sem qualificação -> rótulos no Pipedrive (o inverso de MEETING_RESULTS da importação)
const MEETING_OUTCOME_LABELS: Record<string, string[]> = {
  no_show: ["Não compareceu"],
  rescheduled: ["Remarcada", "Reagendado"],
  canceled: ["Cancelada", "Cancelado"],
};

// Resultado de tentativa do CRM -> rótulos no Pipedrive (o inverso de ATTEMPT_OUTCOMES da importação). Nome igual
// nos dois lados ("Sem resposta", "Reunião agendada") já casa pelo próprio nome.
const ATTEMPT_OUTCOME_LABELS: Record<string, string[]> = {
  "conversa realizada": ["Conectado", "Concluído", "Resposta positiva"],
  "respondeu, pediu retorno": ["Retorno futuro", "Reagendado"],
  "respondeu, sem interesse": ["Resposta negativa"],
  "numero ou perfil invalido": ["Contato inválido"],
};

/**
 * Opção do campo `outcome` da atividade concluída. Reunião realizada leva a qualificação; as outras, o desfecho.
 * Tentativa leva o resultado pelo nome e, sem opção igual, pelo inverso da importação.
 */
function pdOutcome(row: Row, isMeeting: boolean, ctx: PushCtx): number | null {
  const name = nameOf(row.outcome);
  const code = str(row.meeting_outcome);
  let labels: string[];
  if (isMeeting && code && code !== "held") labels = MEETING_OUTCOME_LABELS[code] ?? [];
  else if (name) labels = [name, ...(isMeeting ? [] : (ATTEMPT_OUTCOME_LABELS[norm(name)] ?? []))];
  else labels = [];
  for (const label of labels) {
    const id = ctx.pdOutcomeOf(label);
    if (id !== null) return id;
  }
  return null;
}

// ---- conversões ----------------------------------------------------------------------------------------------

export function toPdOrganization(row: Row, ctx: PushCtx): PushPayload {
  const name = str(row.name);
  if (!name) return fail("organização sem nome");
  return {
    path: PATHS.organizations,
    body: { name, address: addressText(row.address), ...owner("owner_id", row.owner_id, ctx) },
  };
}

export function toPdPerson(row: Row, ctx: PushCtx): PushPayload {
  const name = str(row.full_name);
  if (!name) return fail("pessoa sem nome");
  const org = pdRef("organizations", row.organization_id, ctx);
  if (isFail(org)) return org;
  return {
    path: PATHS.persons,
    body: {
      name,
      email: pdContacts(row.emails, EMAIL_LABELS),
      phone: pdContacts(row.phones, PHONE_LABELS),
      org_id: org,
      ...owner("owner_id", row.owner_id, ctx),
    },
  };
}

export function toPdLead(row: Row, ctx: PushCtx): PushPayload {
  const title = str(row.title);
  if (!title) return fail("lead sem título");
  const person = pdRef("persons", row.person_id, ctx);
  if (isFail(person)) return person;
  const org = pdRef("organizations", row.organization_id, ctx);
  if (isFail(org)) return org;
  if (person === null && org === null) return fail("lead sem pessoa nem organização (o Pipedrive exige um dos dois)");
  const amount = num(row.estimated_value);
  const company = str(row.company_id);
  const label = company ? ctx.pdLeadLabelOf(company) : null;
  return {
    path: PATHS.leads,
    body: {
      title,
      person_id: person,
      organization_id: org,
      ...owner("owner_id", row.owner_id, ctx),
      value: amount === null ? null : { amount, currency: CURRENCY },
      ...(label ? { label_ids: [label] } : {}),
      // o Pipedrive só lista leads em aberto; convertido ou desqualificado no CRM sai da lista arquivado
      is_archived: ["archived", "converted", "disqualified"].includes(str(row.status) ?? ""),
    },
  };
}

export function toPdDeal(row: Row, ctx: PushCtx): PushPayload {
  const title = str(row.title);
  if (!title) return fail("negócio sem título");
  const stageId = str(row.stage_id);
  // a etapa define o funil no Pipedrive
  const stage = stageId ? ctx.pdStageOf(stageId) : null;
  if (stage === null) return fail(`etapa ${stageId ?? "?"} sem correspondente no Pipedrive`);
  const status = str(row.status) ?? "open";
  if (status !== "open" && status !== "won" && status !== "lost") return fail(`status inválido: ${status}`);
  const person = pdRef("persons", row.person_id, ctx);
  if (isFail(person)) return person;
  const org = pdRef("organizations", row.organization_id, ctx);
  if (isFail(org)) return org;
  if (person === null && org === null) return fail("negócio sem pessoa nem organização (o Pipedrive exige um dos dois)");
  const reason = status === "lost" ? nameOf(row.lost_reason) : null;
  return {
    path: PATHS.deals,
    body: {
      ...pdCustom(row, ctx),
      title,
      value: num(row.estimated_value) ?? 0,
      currency: CURRENCY,
      person_id: person,
      org_id: org,
      ...owner("user_id", row.owner_id, ctx),
      stage_id: stage,
      status,
      ...(reason ? { lost_reason: reason } : {}),
      expected_close_date: dateOnly(row.expected_close_date),
    },
  };
}

const ACTIVITY_LINKS: [PushEntity, string, string][] = [
  ["deals", "deal_id", "deal_id"],
  ["leads", "lead_id", "lead_id"],
  ["persons", "person_id", "person_id"],
  ["organizations", "organization_id", "org_id"],
];

export function toPdActivity(row: Row, ctx: PushCtx): PushPayload {
  const subject = str(row.subject);
  if (!subject) return fail("atividade sem assunto");
  const type = row.activity_type;
  if (!type || typeof type !== "object") return fail("atividade sem o tipo carregado");
  const isMeeting = (type as Row).is_meeting === true;
  const due = utcParts(row.due_at);
  if (!due) return fail("atividade sem data");
  const links: Row = {};
  for (const [entity, column, key] of ACTIVITY_LINKS) {
    const ref = pdRef(entity, row[column], ctx);
    if (isFail(ref)) return ref;
    if (ref !== null) links[key] = ref;
  }
  if (!Object.keys(links).length) return fail("atividade sem negócio, lead, pessoa ou organização");
  const done = row.done === true;
  const outcome = done ? pdOutcome(row, isMeeting, ctx) : null;
  const duration = hhmm(row.duration_minutes);
  const description = str(row.description);
  return {
    path: PATHS.activities,
    body: {
      subject,
      type: ctx.pdActivityTypeOf(str((type as Row).name) ?? "", isMeeting),
      due_date: due.date,
      due_time: due.time,
      ...(duration ? { duration } : {}),
      done: done ? 1 : 0,
      note: description ? pdHtml(description) : "",
      ...links,
      ...owner("user_id", row.owner_id, ctx),
      ...(outcome !== null ? { outcome } : {}),
    },
  };
}

const NOTE_LINKS: Record<string, string> = {
  deals: "deal_id",
  leads: "lead_id",
  persons: "person_id",
  organizations: "org_id",
};

/** A anotação do CRM tem um vínculo só: o de maior precedência na importação (negócio, lead, pessoa, organização). */
export function toPdNote(row: Row, ctx: PushCtx): PushPayload {
  const content = str(row.body);
  if (!content) return fail("anotação vazia");
  const entity = str(row.entity);
  const key = entity ? NOTE_LINKS[entity] : undefined;
  if (!entity || !key) return fail(`anotação com vínculo inválido: ${entity ?? "vazio"}`);
  const ref = pdRef(entity as PushEntity, row.record_id, ctx);
  if (isFail(ref)) return ref;
  if (ref === null) return fail("anotação sem registro vinculado");
  return {
    path: PATHS.notes,
    body: { content: pdHtml(content), [key]: ref, ...owner("user_id", row.created_by, ctx) },
  };
}
