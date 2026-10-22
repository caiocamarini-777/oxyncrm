import { describe, expect, it } from "vitest";
import { parseMissingFields, REQUIRED_FIELD_OPTIONS, requiredFieldLabel } from "./required";

describe("requiredFieldLabel", () => {
  it("traduz as chaves fixas", () => {
    expect(REQUIRED_FIELD_OPTIONS.map((o) => o.key)).toEqual([
      "expected_close_date", "person_id", "organization_id", "estimated_value", "contract", "products",
    ]);
    expect(requiredFieldLabel("expected_close_date")).toBe("Data de fechamento esperada");
    expect(requiredFieldLabel("person_id")).toBe("Pessoa");
    expect(requiredFieldLabel("organization_id")).toBe("Organização");
    expect(requiredFieldLabel("estimated_value")).toBe("Valor estimado");
    expect(requiredFieldLabel("contract")).toBe("Condições de contrato");
    expect(requiredFieldLabel("products")).toBe("Produtos");
  });
  it("usa o rótulo do campo personalizado ou a chave", () => {
    const defs = [{ key: "porte", label: "Porte" }];
    expect(requiredFieldLabel("cf:porte", defs)).toBe("Porte");
    expect(requiredFieldLabel("cf:outro", defs)).toBe("cf:outro");
    expect(requiredFieldLabel("zzz")).toBe("zzz");
  });
});

describe("parseMissingFields", () => {
  it("separa por vírgula", () => {
    expect(parseMissingFields("person_id,cf:porte")).toEqual(["person_id", "cf:porte"]);
    expect(parseMissingFields("")).toEqual([]);
    expect(parseMissingFields(" a , b ")).toEqual(["a", "b"]);
  });
});
