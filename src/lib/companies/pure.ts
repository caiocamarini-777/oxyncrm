export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

export type CompanyScope =
  | { kind: "all" }
  | { kind: "company"; company: CompanySummary };

import { ALL_COMPANIES_SLUG } from "./constants";

export { ALL_COMPANIES_SLUG, LAST_COMPANY_COOKIE } from "./constants";

// Primeiros segmentos que não são slug de empresa.
const UNSCOPED_ROOTS = new Set([
  "perfil",
  "configuracoes",
  "sem-acesso",
  "entrar",
  "recuperar-senha",
  "definir-senha",
  "auth",
]);

export function resolveCompanyScope(
  param: string,
  companies: CompanySummary[],
  isSuperAdmin: boolean,
): CompanyScope | null {
  if (param === ALL_COMPANIES_SLUG) {
    return isSuperAdmin || companies.length >= 2 ? { kind: "all" } : null;
  }
  const company = companies.find((c) => c.slug === param);
  return company ? { kind: "company", company } : null;
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Segmentos que só existem antes de um id (relatorios/r/<id>, relatorios/paineis/<id>).
const ID_PARENTS = new Set(["r", "paineis"]);

/**
 * Caminho equivalente em outra empresa. Em "todas" o registro continua visível; numa empresa
 * específica ele pode ser de outra, então a troca volta para a lista da seção.
 */
export function switchCompanyPath(pathname: string, newSlug: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first || UNSCOPED_ROOTS.has(first)) return `/${newSlug}/inicio`;
  let rest = segments.slice(1);
  if (newSlug !== ALL_COMPANIES_SLUG) {
    const id = rest.findIndex((s) => UUID_SEGMENT.test(s));
    if (id >= 0) rest = rest.slice(0, id);
    if (rest.length > 1 && ID_PARENTS.has(rest[rest.length - 1]!)) rest = rest.slice(0, -1);
  }
  return `/${[newSlug, ...rest].join("/")}`;
}

/** Empresas criadas pelos testes automáticos (slug tst-) ficam visíveis só para contas de teste. */
export function hideTestCompanies(companies: CompanySummary[], email: string | null | undefined): CompanySummary[] {
  if (email?.toLowerCase().endsWith("@oxyn.test")) return companies;
  return companies.filter((c) => !c.slug.startsWith("tst-"));
}

export function pickDefaultCompany(
  companies: CompanySummary[],
  lastSlug: string | undefined,
): CompanySummary | null {
  return companies.find((c) => c.slug === lastSlug) ?? companies[0] ?? null;
}


/** Slug de escopo exibido no shell: o da URL quando válido; senão a empresa padrão; senão null. */
export function deriveScopeSlug(
  pathname: string,
  companies: CompanySummary[],
  isSuperAdmin: boolean,
  lastSlug: string | undefined,
): string | null {
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  const scope = resolveCompanyScope(first, companies, isSuperAdmin);
  if (scope) return scope.kind === "all" ? ALL_COMPANIES_SLUG : scope.company.slug;
  return pickDefaultCompany(companies, lastSlug)?.slug ?? null;
}
