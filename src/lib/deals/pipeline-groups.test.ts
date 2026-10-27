import { describe, expect, it } from "vitest";
import { pipelineGroups } from "./pipeline-groups";

const dir = [
  { id: "p1", name: "OXYN", companyName: "Oxyn", companySlug: "oxyn" },
  { id: "p2", name: "HARPIX", companyName: "HARPIX", companySlug: "harpix" },
  { id: "p3", name: "Pós-venda", companyName: "HARPIX", companySlug: "harpix" },
  { id: "p4", name: "NAIA", companyName: "NAIA", companySlug: "naia" },
];

describe("pipelineGroups", () => {
  it("agrupa por empresa com a empresa aberta primeiro e as demais em ordem alfabética", () => {
    const g = pipelineGroups(dir, [{ id: "p4", name: "NAIA" }], "naia");
    expect(g.map((x) => x.slug)).toEqual(["naia", "harpix", "oxyn"]);
    expect(g[1].pipelines.map((p) => p.id)).toEqual(["p2", "p3"]);
  });
  it("em Todas as empresas lista todas em ordem alfabética", () => {
    expect(pipelineGroups(dir, [], null).map((x) => x.name)).toEqual(["HARPIX", "NAIA", "Oxyn"]);
  });
  it("sem diretório usa só os funis da empresa aberta", () => {
    expect(pipelineGroups([], [{ id: "a", name: "Vendas" }], "oxyn")).toEqual([
      { slug: "oxyn", name: "Funis", pipelines: [{ id: "a", name: "Vendas" }] },
    ]);
    expect(pipelineGroups([], [], "oxyn")).toEqual([]);
  });
});
