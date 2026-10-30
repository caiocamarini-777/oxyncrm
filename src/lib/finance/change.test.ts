import { describe, expect, it } from "vitest";
import { changeInfo } from "./change";

const base = {
  status: "open" as const,
  locked: false,
  amount: 1000,
  settledAmount: null,
  originalGross: null,
  originalDueDate: null,
};
const nbsp = (s: string) => s.replace(/ /g, " ");

describe("changeInfo", () => {
  it("sem alteração: nada", () => {
    expect(changeInfo(base)).toEqual({ kind: null, text: "" });
  });
  it("editado: mostra o previsto original e a data", () => {
    const r = changeInfo({ ...base, locked: true, amount: 1200, originalGross: 1000, originalDueDate: "2026-11-10" });
    expect(r.kind).toBe("edited");
    expect(nbsp(r.text)).toBe("editado · previsto R$ 1.000,00 em 10/11");
  });
  it("editado sem data original: omite a data", () => {
    const r = changeInfo({ ...base, locked: true, originalGross: 1000 });
    expect(nbsp(r.text)).toBe("editado · previsto R$ 1.000,00");
  });
  it("travado sem original (editado antes dos originais): selo simples", () => {
    expect(changeInfo({ ...base, locked: true })).toEqual({ kind: "edited", text: "editado" });
  });
  it("pago com valor diferente", () => {
    const r = changeInfo({ ...base, status: "settled", settledAmount: 900 });
    expect(r.kind).toBe("paid_diff");
    expect(nbsp(r.text)).toBe("pago R$ 900,00 · previsto R$ 1.000,00");
  });
  it("pago com o mesmo valor: nada", () => {
    expect(changeInfo({ ...base, status: "settled", settledAmount: 1000 }).kind).toBeNull();
  });
  it("em aberto com settledAmount não conta", () => {
    expect(changeInfo({ ...base, settledAmount: 5 }).kind).toBeNull();
  });
  it("editado e pago diferente: editado vence e a linha de pago é anexada", () => {
    const r = changeInfo({ ...base, status: "settled", locked: true, amount: 1200, settledAmount: 1100, originalGross: 1000, originalDueDate: "2026-11-10" });
    expect(r.kind).toBe("edited");
    expect(nbsp(r.text)).toBe("editado · previsto R$ 1.000,00 em 10/11 · pago R$ 1.100,00");
  });
});
