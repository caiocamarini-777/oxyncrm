import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./cron-auth";

describe("isCronAuthorized", () => {
  it("aceita o segredo correto", () => expect(isCronAuthorized("Bearer s3", "s3")).toBe(true));
  it("recusa cabeçalho ausente, esquema errado ou segredo errado", () => {
    expect(isCronAuthorized(null, "s3")).toBe(false);
    expect(isCronAuthorized("Basic s3", "s3")).toBe(false);
    expect(isCronAuthorized("Bearer s4", "s3")).toBe(false);
    expect(isCronAuthorized("Bearer ", "s3")).toBe(false);
  });
  it("sem segredo configurado nega tudo", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer x", undefined)).toBe(false);
  });
});
