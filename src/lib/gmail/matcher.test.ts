import { describe, expect, it } from "vitest";
import { type ContactIndex, matchMessage } from "./matcher";

const index: ContactIndex = {
  personsByEmail: new Map([
    ["maria@acme.com", [{ id: "p1", organizationId: "o1" }]],
    ["solo@gmail.com", [{ id: "p2", organizationId: null }]],
    ["colega@oxyn.com", [{ id: "p3", organizationId: null }]],
  ]),
  orgsByDomain: new Map([
    ["acme.com", ["o1"]],
    ["beta.com", ["o2"]],
    ["gmail.com", ["o9"]],
    ["oxyn.com", ["o8"]],
  ]),
  openLeads: [
    { id: "l1", personId: "p1", organizationId: null },
    { id: "l2", personId: null, organizationId: "o1" },
    { id: "l3", personId: "p2", organizationId: null },
    { id: "l4", personId: null, organizationId: "o2" },
  ],
  openDeals: [
    { id: "d1", personId: "p1", organizationId: "o1" },
    { id: "d2", personId: "p9", organizationId: "o1" },
    { id: "d3", personId: null, organizationId: "o2" },
  ],
};

const own = "ana@oxyn.com";
const keys = (r: { entity: string; recordId: string }[]) => r.map((x) => `${x.entity}:${x.recordId}`).sort();

describe("matchMessage", () => {
  it("pessoa casa com ela, a organização e leads/negócios dela ou da organização", () => {
    expect(keys(matchMessage(["maria@acme.com"], own, index))).toEqual(
      ["deals:d1", "deals:d2", "leads:l1", "leads:l2", "organizations:o1", "persons:p1"].sort(),
    );
  });

  it("domínio casa com a organização e seus leads/negócios abertos, sem pessoa", () => {
    expect(keys(matchMessage(["fulano@beta.com"], own, index))).toEqual(
      ["deals:d3", "leads:l4", "organizations:o2"].sort(),
    );
  });

  it("ignora maiúsculas e espaços", () => {
    expect(keys(matchMessage([" Fulano@BETA.com "], own, index))).toContain("organizations:o2");
    expect(keys(matchMessage(["MARIA@Acme.com"], own, index))).toContain("persons:p1");
  });

  it("pessoa em domínio genérico casa pelo e-mail, mas o domínio genérico não casa", () => {
    expect(keys(matchMessage(["solo@gmail.com"], own, index))).toEqual(["leads:l3", "persons:p2"]);
    expect(matchMessage(["outro@gmail.com"], own, index)).toEqual([]);
  });

  it("ignora a própria caixa e o domínio dela", () => {
    expect(matchMessage([own], own, index)).toEqual([]);
    expect(matchMessage(["Ana@Oxyn.com", "novo@oxyn.com"], own, index)).toEqual([]);
  });

  it("pessoa cadastrada no domínio da caixa ainda casa, sem puxar a organização do domínio", () => {
    expect(keys(matchMessage(["colega@oxyn.com"], own, index))).toEqual(["persons:p3"]);
  });

  it("sem duplicatas quando pessoa e domínio apontam para o mesmo card", () => {
    const r = matchMessage(["maria@acme.com", "outro@acme.com", "maria@acme.com"], own, index);
    expect(r).toHaveLength(new Set(keys(r)).size);
    expect(keys(r)).toContain("organizations:o1");
  });

  it("sem casamento devolve lista vazia", () => {
    expect(matchMessage(["x@desconhecido.com"], own, index)).toEqual([]);
    expect(matchMessage([], own, index)).toEqual([]);
  });
});
