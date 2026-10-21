export const RECORD_ENTITIES = ["organizations", "persons", "leads"] as const;
export type RecordEntity = (typeof RECORD_ENTITIES)[number];

export const PAGE_SIZE = 50 as const;

export type ListQuery = {
  q: string;
  page: number;
  sort: string;
  dir: "asc" | "desc";
  owner: string[];
  label: string[];
  status: string[];
  source: string[];
  createdFrom: string | null;
  createdTo: string | null;
};

export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: 50 };

export type EntityPermissions = {
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
  reassign: boolean;
};

export type AssignableOwner = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  active: boolean;
};

export const ENTITY_PATHS: Record<RecordEntity, string> = {
  organizations: "organizacoes",
  persons: "pessoas",
  leads: "leads",
};
