import { describe, expect, it } from "vitest";
import { readCalendarSettings, withCalendarSettings } from "./settings";

const T1 = new Date("2026-11-11T12:00:00.000Z");
const T2 = new Date("2026-12-01T09:30:00.000Z");

describe("readCalendarSettings", () => {
  it.each([
    ["nulo", null],
    ["indefinido", undefined],
    ["vazio", {}],
    ["texto", "x"],
    ["lista", []],
    ["sem a chave da Agenda", { meeting_assistant: { enabled: true } }],
    ["Agenda que não é objeto", { calendar_sync: true }],
    ["Agenda em lista", { calendar_sync: [{ enabled: true }] }],
  ])("%s: desligada e sem data", (_, settings) => {
    expect(readCalendarSettings(settings)).toEqual({ enabled: false, enabledAt: null });
  });

  it("lê o liga/desliga e a data gravados", () => {
    expect(readCalendarSettings({ calendar_sync: { enabled: true, enabled_at: "2026-11-11T12:00:00.000Z" } })).toEqual({
      enabled: true,
      enabledAt: "2026-11-11T12:00:00.000Z",
    });
    expect(readCalendarSettings({ calendar_sync: { enabled: false, enabled_at: "2026-11-11T12:00:00.000Z" } })).toEqual({
      enabled: false,
      enabledAt: "2026-11-11T12:00:00.000Z",
    });
  });

  it("só o booleano true liga", () => {
    for (const enabled of ["true", 1, "on", {}, null]) {
      expect(readCalendarSettings({ calendar_sync: { enabled } }).enabled).toBe(false);
    }
    expect(readCalendarSettings({ calendar_sync: { enabled: true } }).enabled).toBe(true);
  });

  it("ignora enabled_at que não é uma data em texto", () => {
    for (const enabled_at of [123, null, "ontem", "", {}]) {
      expect(readCalendarSettings({ calendar_sync: { enabled: true, enabled_at } }).enabledAt).toBeNull();
    }
  });
});

describe("withCalendarSettings", () => {
  it("ligar grava enabled_at com a hora de agora", () => {
    expect(withCalendarSettings({}, true, T1)).toEqual({
      calendar_sync: { enabled: true, enabled_at: "2026-11-11T12:00:00.000Z" },
    });
    expect(withCalendarSettings(null, true, T1)).toEqual({
      calendar_sync: { enabled: true, enabled_at: "2026-11-11T12:00:00.000Z" },
    });
  });

  it("desligar mantém o histórico do enabled_at", () => {
    const on = withCalendarSettings({}, true, T1);
    const off = withCalendarSettings(on, false, T2);
    expect(off).toEqual({ calendar_sync: { enabled: false, enabled_at: "2026-11-11T12:00:00.000Z" } });
    expect(readCalendarSettings(off)).toEqual({ enabled: false, enabledAt: "2026-11-11T12:00:00.000Z" });
  });

  it("desligar uma Agenda que nunca foi ligada não inventa data", () => {
    expect(withCalendarSettings({}, false, T1)).toEqual({ calendar_sync: { enabled: false, enabled_at: null } });
  });

  it("ligar de novo depois de desligar grava a data nova", () => {
    const off = withCalendarSettings(withCalendarSettings({}, true, T1), false, T1);
    expect(withCalendarSettings(off, true, T2)).toEqual({
      calendar_sync: { enabled: true, enabled_at: "2026-12-01T09:30:00.000Z" },
    });
  });

  it("ligar uma Agenda que já está ligada não muda a data da virada", () => {
    const on = withCalendarSettings({}, true, T1);
    expect(withCalendarSettings(on, true, T2)).toEqual(on);
  });

  it("preserva as outras chaves de settings e as da própria Agenda", () => {
    const base = {
      meeting_assistant: { enabled: true, questions: ["Dor principal"] },
      calendar_sync: { enabled: false, enabled_at: null, extra: 1 },
      other: "x",
    };
    expect(withCalendarSettings(base, true, T1)).toEqual({
      meeting_assistant: { enabled: true, questions: ["Dor principal"] },
      calendar_sync: { enabled: true, enabled_at: "2026-11-11T12:00:00.000Z", extra: 1 },
      other: "x",
    });
  });

  it("não muda o objeto recebido", () => {
    const base = { calendar_sync: { enabled: false, enabled_at: null } };
    withCalendarSettings(base, true, T1);
    expect(base).toEqual({ calendar_sync: { enabled: false, enabled_at: null } });
  });

  it("settings fora do formato é tratado como vazio", () => {
    expect(withCalendarSettings("x", true, T1)).toEqual({
      calendar_sync: { enabled: true, enabled_at: "2026-11-11T12:00:00.000Z" },
    });
  });
});
