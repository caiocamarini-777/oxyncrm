import type { ACTIONS, ENTITIES, SETTINGS, VISIBILITY } from "./schema";

export const PERMISSION_LABELS = {
  entities: {
    leads: "Leads",
    deals: "Negócios",
    persons: "Pessoas",
    organizations: "Organizações",
    activities: "Atividades",
  } satisfies Record<(typeof ENTITIES)[number], string>,
  visibility: {
    own: "Só os meus",
    team: "Da minha equipe",
    company: "Toda a empresa",
  } satisfies Record<(typeof VISIBILITY)[number], string>,
  actions: {
    create: "Criar",
    edit: "Editar",
    delete: "Excluir",
    export: "Exportar",
    reassign_owner: "Reatribuir responsável",
  } satisfies Record<(typeof ACTIONS)[number], string>,
  settings: {
    manage_pipelines: "Editar funis e etapas",
    manage_custom_fields: "Editar campos personalizados",
    manage_products: "Editar produtos",
    view_reports: "Ver relatórios",
    create_dashboards: "Criar dashboards",
    share_dashboards: "Compartilhar dashboards",
    view_finance: "Ver financeiro",
    manage_finance: "Gerenciar financeiro",
    register_sales: "Cadastrar vendas de clientes",
  } satisfies Record<(typeof SETTINGS)[number], string>,
};
