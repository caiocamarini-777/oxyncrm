import { describe, expect, it } from "vitest";
import { contractColumns } from "./contract-columns";
import { contractSchema } from "./schema";

const base = { title: "Contrato", endRule: "renew_adjust", renewalMonths: "12", adjustRate: "4,5" };

describe("contractColumns", () => {
  it("índice guarda a estimativa do índice em adjust_rate", () => {
    const c = contractColumns(contractSchema.parse({ ...base, adjustKind: "index", adjustIndex: "IPCA" }));
    expect(c).toMatchObject({ adjust_kind: "index", adjust_index: "IPCA", adjust_rate: 4.5 });
  });
  it("percentual guarda o % e não guarda índice", () => {
    const c = contractColumns(contractSchema.parse({ ...base, adjustKind: "percent", adjustIndex: "IPCA" }));
    expect(c).toMatchObject({ adjust_kind: "percent", adjust_index: null, adjust_rate: 4.5 });
  });
  it("sem reajuste zera o %", () => {
    const c = contractColumns(contractSchema.parse({ ...base, adjustKind: "none" }));
    expect(c).toMatchObject({ adjust_kind: "none", adjust_index: null, adjust_rate: 0 });
  });
});
