import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Servidor HTTP local que imita os endpoints da API v1 do Pipedrive usados pelo cliente de importação.
 * Autenticação só pelo header x-api-token (token errado ou ausente: 401). Nunca aponta para o Pipedrive real.
 */

type Item = Record<string, unknown>;

export type FakeUsers = {
  /** e-mail do admin geral do teste (casado automaticamente) */
  adminEmail: string;
  /** e-mail do vendedor, membro só da empresa existente */
  sellerEmail: string;
};

const hex = (c: string) => c.repeat(40);
export const FIELD_KEYS = {
  setup: hex("a"),
  mrr: hex("b"),
  prazo: hex("c"),
  temperatura: hex("d"),
  cargo: hex("e"),
};

/**
 * Fixture pequena: 2 funis, 4 etapas, 2 usuários, 3 organizações, 4 pessoas, 3 leads com etiquetas,
 * 3 negócios (won, lost, open), 5 atividades (uma sem vínculo, erro proposital) e 2 anotações.
 * O funil 1 vai para uma empresa nova; o 2 para a empresa existente.
 */
export function buildFixture(stamp: number, users: FakeUsers) {
  const alfa = `Alfa ${stamp}`;
  const beta = `Beta ${stamp}`;
  return {
    names: { alfa, beta },
    pipelines: [
      { id: 1, name: alfa, active: true },
      { id: 2, name: beta, active: true },
    ],
    stages: [
      { id: 11, name: "Prospecção", pipeline_id: 1, order_nr: 1, deal_probability: 10 },
      { id: 12, name: "Proposta", pipeline_id: 1, order_nr: 2, deal_probability: 60 },
      { id: 21, name: "Contato", pipeline_id: 2, order_nr: 1, deal_probability: 20 },
      { id: 22, name: "Fechamento", pipeline_id: 2, order_nr: 2, deal_probability: 90 },
    ],
    users: [
      { id: 501, name: "Admin Pipedrive", email: users.adminEmail, active_flag: true },
      { id: 502, name: "Vendedor Pipedrive", email: users.sellerEmail, active_flag: true },
    ],
    activityTypes: [
      { id: 1, key_string: "call", name: "Ligação" },
      { id: 2, key_string: "meeting", name: "Reunião agendada" },
      { id: 3, key_string: "task", name: "Whatsapp" },
      { id: 4, key_string: "email", name: "E-mail" },
    ],
    leadLabels: [
      { id: "lab-alfa", name: `ALFA ${stamp}`, color: "green" },
      { id: "lab-beta", name: `BETA ${stamp}`, color: "blue" },
      { id: "lab-hot", name: "Hot", color: "red" },
    ],
    dealFields: [
      { key: "title", name: "Título", field_type: "varchar", edit_flag: false },
      { key: "value", name: "Valor", field_type: "monetary", edit_flag: false },
      { key: FIELD_KEYS.setup, name: "Setup", field_type: "monetary", edit_flag: true },
      { key: FIELD_KEYS.mrr, name: "MRR contratado", field_type: "monetary", edit_flag: true },
      { key: FIELD_KEYS.prazo, name: "Prazo (meses)", field_type: "double", edit_flag: true },
      {
        key: FIELD_KEYS.temperatura,
        name: "Temperatura",
        field_type: "enum",
        edit_flag: true,
        options: [
          { id: 1, label: "Quente" },
          { id: 2, label: "Frio" },
        ],
      },
    ],
    personFields: [
      { key: "name", name: "Nome", field_type: "varchar", edit_flag: false },
      { key: FIELD_KEYS.cargo, name: "Cargo", field_type: "varchar", edit_flag: true },
    ],
    organizationFields: [{ key: "name", name: "Nome", field_type: "varchar", edit_flag: false }],
    organizations: [
      { id: 1, name: `Org Um ${stamp}`, owner_id: 501, add_time: "2023-01-10 12:00:00" },
      { id: 2, name: `Org Dois ${stamp}`, owner_id: 501, add_time: "2023-01-11 12:00:00" },
      { id: 3, name: `Org Três ${stamp}`, owner_id: 502, add_time: "2023-01-12 12:00:00" },
    ],
    persons: [
      { id: 1, name: `Pessoa Um ${stamp}`, owner_id: 501, org_id: 1, email: [{ value: "um@exemplo.test", primary: true }], [FIELD_KEYS.cargo]: "Diretora" },
      { id: 2, name: `Pessoa Dois ${stamp}`, owner_id: 501, org_id: 2, phone: [{ value: "+55 11 99999-0000" }] },
      { id: 3, name: `Pessoa Três ${stamp}`, owner_id: 502, org_id: 3 },
      { id: 4, name: `Pessoa Quatro ${stamp}`, owner_id: 502 },
    ],
    leads: [
      {
        id: "lead-1",
        title: `Lead Um ${stamp}`,
        owner_id: 501,
        person_id: 1,
        organization_id: 1,
        label_ids: ["lab-alfa", "lab-hot"],
        value: { amount: 1500, currency: "BRL" },
        is_archived: false,
        add_time: "2024-01-05T10:00:00.000Z",
      },
      {
        id: "lead-2",
        title: `Lead Dois ${stamp}`,
        owner_id: 502,
        person_id: 3,
        organization_id: 3,
        label_ids: ["lab-beta"],
        is_archived: false,
        add_time: "2024-01-06T10:00:00.000Z",
      },
      {
        id: "lead-3",
        title: `Lead Três ${stamp}`,
        owner_id: 501,
        label_ids: ["lab-hot"],
        is_archived: false,
        add_time: "2024-01-07T10:00:00.000Z",
      },
    ],
    archivedLeads: [] as Item[],
    deals: [
      {
        id: 1,
        title: `Negócio Ganho ${stamp}`,
        pipeline_id: 1,
        stage_id: 12,
        status: "won",
        user_id: { id: 501, name: "Admin Pipedrive" },
        person_id: { value: 1, name: "Pessoa Um" },
        org_id: { value: 1, name: "Org Um" },
        value: 12000,
        currency: "BRL",
        add_time: "2024-02-01 09:00:00",
        won_time: "2024-03-15 10:00:00",
        stage_change_time: "2024-03-10 08:00:00",
        [FIELD_KEYS.setup]: 5000,
        [FIELD_KEYS.mrr]: 1000,
        [FIELD_KEYS.prazo]: 12,
        [FIELD_KEYS.temperatura]: "1",
      },
      {
        id: 2,
        title: `Negócio Perdido ${stamp}`,
        pipeline_id: 1,
        stage_id: 11,
        status: "lost",
        user_id: { id: 501, name: "Admin Pipedrive" },
        person_id: { value: 2, name: "Pessoa Dois" },
        org_id: { value: 2, name: "Org Dois" },
        value: 3000,
        add_time: "2024-02-02 09:00:00",
        lost_time: "2024-04-01 15:00:00",
        lost_reason: "Preço",
      },
      {
        id: 3,
        title: `Negócio Aberto ${stamp}`,
        pipeline_id: 2,
        stage_id: 21,
        status: "open",
        user_id: { id: 502, name: "Vendedor Pipedrive" },
        person_id: { value: 4, name: "Pessoa Quatro" },
        value: 8000,
        add_time: "2024-02-03 09:00:00",
        expected_close_date: "2024-12-20",
      },
    ],
    activities: [
      { id: 1, type: "call", subject: `Ligação ganho ${stamp}`, deal_id: 1, person_id: 1, user_id: 501, done: true, due_date: "2024-03-01", due_time: "14:00", marked_as_done_time: "2024-03-01 14:30:00", add_time: "2024-02-20 10:00:00" },
      { id: 2, type: "meeting", subject: `Reunião aberto ${stamp}`, deal_id: 3, person_id: 4, user_id: 502, done: false, due_date: "2024-05-10", due_time: "", add_time: "2024-02-21 10:00:00" },
      { id: 3, type: "email", subject: `E-mail pessoa ${stamp}`, person_id: 2, user_id: 501, done: true, due_date: "2024-02-22", marked_as_done_time: "2024-02-22 11:00:00", add_time: "2024-02-22 10:00:00" },
      { id: 4, type: "task", subject: `Whatsapp lead ${stamp}`, lead_id: "lead-1", user_id: 501, done: false, due_date: "2024-06-01", add_time: "2024-02-23 10:00:00" },
      { id: 5, type: "call", subject: `Sem vínculo ${stamp}`, user_id: 501, done: false, due_date: "2024-06-02", add_time: "2024-02-24 10:00:00" },
    ],
    notes: [
      { id: 1, content: `Nota do negócio ${stamp}`, deal_id: 1, user_id: 501, add_time: "2024-03-16 10:00:00" },
      { id: 2, content: `Nota da pessoa ${stamp}`, person_id: 2, user_id: 501, add_time: "2024-03-17 10:00:00" },
    ],
    products: [] as Item[],
  };
}

export type Fixture = ReturnType<typeof buildFixture>;

const LISTS: Record<string, keyof Fixture> = {
  "/v1/pipelines": "pipelines",
  "/v1/stages": "stages",
  "/v1/users": "users",
  "/v1/activityTypes": "activityTypes",
  "/v1/leadLabels": "leadLabels",
  "/v1/dealFields": "dealFields",
  "/v1/personFields": "personFields",
  "/v1/organizationFields": "organizationFields",
  "/v1/organizations": "organizations",
  "/v1/persons": "persons",
  "/v1/leads": "leads",
  "/v1/leads/archived": "archivedLeads",
  "/v1/deals": "deals",
  "/v1/activities": "activities",
  "/v1/notes": "notes",
  "/v1/products": "products",
};

export type FakePipedrive = {
  url: string;
  /** troca o token aceito (o token configurado no Next passa a receber 401) */
  setToken(token: string): void;
  /** atraso por requisição (para dar tempo de pausar) */
  setDelay(ms: number): void;
  /** caminhos pedidos (sem query) e quantos chegaram sem o token certo */
  requests: string[];
  rejected: number;
  close(): Promise<void>;
};

export async function startFakePipedrive(fixture: Fixture, token: string, pageSize = 2): Promise<FakePipedrive> {
  let accepted = token;
  let delay = 0;
  const state = { requests: [] as string[], rejected: 0 };
  const server = http.createServer(async (req, res) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const url = new URL(req.url ?? "/", "http://localhost");
    state.requests.push(url.pathname);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-token"] !== accepted || url.searchParams.has("api_token")) {
      state.rejected++;
      return send(401, { success: false, error: "unauthorized access", errorCode: 401 });
    }
    if (url.pathname === "/v1/users/me") return send(200, { success: true, data: fixture.users[0] });
    const key = LISTS[url.pathname];
    if (!key) return send(404, { success: false, error: "not found" });
    const all = fixture[key] as unknown[];
    // listas de metadados vêm inteiras; entidades paginam com pageSize (exercita next_start)
    const start = Number(url.searchParams.get("start") ?? 0);
    const asked = Number(url.searchParams.get("limit") ?? 100);
    const limit = url.searchParams.has("start") ? Math.min(asked, pageSize) : asked;
    const items = all.slice(start, start + limit);
    const more = start + limit < all.length;
    send(200, {
      success: true,
      data: items,
      additional_data: { pagination: { start, limit, more_items_in_collection: more, ...(more ? { next_start: start + limit } : {}) } },
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    setToken: (t) => {
      accepted = t;
    },
    setDelay: (ms) => {
      delay = ms;
    },
    get requests() {
      return state.requests;
    },
    get rejected() {
      return state.rejected;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
