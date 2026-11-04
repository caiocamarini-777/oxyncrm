import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadContactIndex } from "./index-loader";

/** Banco falso: cada tabela é uma lista; `.range` fatia como o PostgREST. */
function fakeDb(tables: Record<string, unknown[]>, ranges: Record<string, [number, number][]>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const op of ["select", "eq", "is", "not", "order"]) chain[op] = () => chain;
      chain.range = async (a: number, b: number) => {
        (ranges[table] ??= []).push([a, b]);
        return { data: (tables[table] ?? []).slice(a, b + 1), error: null };
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("loadContactIndex", () => {
  it("pagina além de 1.000 linhas e monta o índice em minúsculas", async () => {
    const persons = Array.from({ length: 2500 }, (_, i) => ({
      id: `p${i}`,
      organization_id: i % 2 ? "o1" : null,
      emails: [{ value: `User${i}@Acme.com` }, { value: "  " }, { label: "x" }],
    }));
    const ranges: Record<string, [number, number][]> = {};
    const db = fakeDb(
      {
        persons,
        organizations: [{ id: "o1", domain: "Acme.com" }, { id: "o2", domain: null }],
        leads: [{ id: "l1", person_id: "p1", organization_id: null }],
        deals: [{ id: "d1", person_id: null, organization_id: "o1" }],
      },
      ranges,
    );

    const idx = await loadContactIndex(db, "co1");

    expect(ranges.persons).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(idx.personsByEmail.size).toBe(2500);
    expect(idx.personsByEmail.get("user1@acme.com")).toEqual([{ id: "p1", organizationId: "o1" }]);
    expect(idx.orgsByDomain.get("acme.com")).toEqual(["o1"]);
    expect(idx.openLeads).toEqual([{ id: "l1", personId: "p1", organizationId: null }]);
    expect(idx.openDeals).toEqual([{ id: "d1", personId: null, organizationId: "o1" }]);
  });

  it("uma página cheia pede a seguinte (exatamente 1.000 linhas)", async () => {
    const ranges: Record<string, [number, number][]> = {};
    const leads = Array.from({ length: 1000 }, (_, i) => ({ id: `l${i}`, person_id: null, organization_id: null }));
    const idx = await loadContactIndex(fakeDb({ leads }, ranges), "co1");
    expect(ranges.leads).toEqual([[0, 999], [1000, 1999]]);
    expect(idx.openLeads).toHaveLength(1000);
  });
});
