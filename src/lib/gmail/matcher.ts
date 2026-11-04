import { domainOf, GENERIC_DOMAINS } from "./addresses";

type Ref = { id: string; personId: string | null; organizationId: string | null };

/** Índice da empresa da caixa: só registros não apagados; leads e negócios só abertos. */
export type ContactIndex = {
  /** e-mail (minúsculo) -> pessoas */
  personsByEmail: Map<string, { id: string; organizationId: string | null }[]>;
  /** domínio (minúsculo) -> organizações */
  orgsByDomain: Map<string, string[]>;
  openLeads: Ref[];
  openDeals: Ref[];
};

export type EmailLinkTarget = {
  entity: "persons" | "organizations" | "leads" | "deals";
  recordId: string;
};

/**
 * Casa os endereços de uma mensagem com os cards da empresa.
 * Pessoa -> ela, a organização dela e os leads/negócios abertos dela ou da organização.
 * Domínio -> a organização e os leads/negócios abertos dela. Ignora a própria caixa,
 * o domínio dela e os domínios genéricos (estes só valem para casar por domínio).
 */
export function matchMessage(addresses: string[], ownEmail: string, index: ContactIndex): EmailLinkTarget[] {
  const own = ownEmail.trim().toLowerCase();
  const ownDomain = domainOf(own);
  const seen = new Set<string>();
  const out: EmailLinkTarget[] = [];

  const add = (entity: EmailLinkTarget["entity"], recordId: string) => {
    const key = `${entity}:${recordId}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ entity, recordId });
  };

  const addOrgCards = (orgId: string) => {
    add("organizations", orgId);
    for (const l of index.openLeads) if (l.organizationId === orgId) add("leads", l.id);
    for (const d of index.openDeals) if (d.organizationId === orgId) add("deals", d.id);
  };

  for (const raw of addresses) {
    const email = raw.trim().toLowerCase();
    if (!email || email === own) continue;
    const domain = domainOf(email);

    for (const person of index.personsByEmail.get(email) ?? []) {
      add("persons", person.id);
      if (person.organizationId) add("organizations", person.organizationId);
      for (const l of index.openLeads) {
        if (l.personId === person.id || (person.organizationId && l.organizationId === person.organizationId)) {
          add("leads", l.id);
        }
      }
      for (const d of index.openDeals) {
        if (d.personId === person.id || (person.organizationId && d.organizationId === person.organizationId)) {
          add("deals", d.id);
        }
      }
    }

    if (domain && domain !== ownDomain && !GENERIC_DOMAINS.has(domain)) {
      for (const orgId of index.orgsByDomain.get(domain) ?? []) addOrgCards(orgId);
    }
  }
  return out;
}
