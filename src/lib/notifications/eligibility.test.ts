import { describe, expect, it } from "vitest";
import { emailDecision } from "./eligibility";

const profile = { email: "a@b.c", active: true };
const activity = { done: false, deleted_at: null, owner_id: "u1" };

describe("emailDecision", () => {
  it("envia quando tudo confere", () => expect(emailDecision({ userId: "u1", profile, activity, isMember: true })).toBe("send"));
  it("ignora atividade concluída, excluída ou de outro responsável", () => {
    expect(emailDecision({ userId: "u1", profile, activity: { ...activity, done: true }, isMember: true })).toBe("stale");
    expect(emailDecision({ userId: "u1", profile, activity: { ...activity, deleted_at: "x" }, isMember: true })).toBe("stale");
    expect(emailDecision({ userId: "u1", profile, activity: { ...activity, owner_id: "u2" }, isMember: true })).toBe("stale");
  });
  it("usuário inativo ou sem perfil", () => {
    expect(emailDecision({ userId: "u1", profile: { ...profile, active: false }, activity, isMember: true })).toBe("inactive");
    expect(emailDecision({ userId: "u1", profile: null, activity, isMember: true })).toBe("inactive");
  });
  it("dono que saiu da empresa não recebe", () => {
    expect(emailDecision({ userId: "u1", profile, activity, isMember: false })).toBe("inactive");
  });
  it("atividade reatribuída vence a checagem de vínculo", () => {
    expect(emailDecision({ userId: "u1", profile, activity: { ...activity, owner_id: "u2" }, isMember: false })).toBe("stale");
  });
});
