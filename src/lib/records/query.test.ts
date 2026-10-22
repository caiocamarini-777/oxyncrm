import { describe, expect, it } from "vitest";
import { parseListQuery, serializeListQuery } from "./query";

describe("parseListQuery", () => {
  it("valores inválidos caem no padrão", () => {
    const q = parseListQuery(new URLSearchParams("page=0&sort=hack&dir=x"), ["name"]);
    expect(q.page).toBe(1);
    expect(q.sort).toBe("created_at");
    expect(q.dir).toBe("desc");
  });
  it("owner repetido vira lista", () => {
    expect(parseListQuery(new URLSearchParams("owner=00000000-0000-4000-8000-00000000000a&owner=00000000-0000-4000-8000-00000000000b"), []).owner).toEqual(["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"]);
  });
  it("owner e label que não são uuid são descartados", () => {
    const q = parseListQuery(new URLSearchParams("owner=a&owner=00000000-0000-4000-8000-00000000000a&label=x'%3B--&label=00000000-0000-4000-8000-00000000000b"), []);
    expect(q.owner).toEqual(["00000000-0000-4000-8000-00000000000a"]);
    expect(q.label).toEqual(["00000000-0000-4000-8000-00000000000b"]);
  });
  it("aceita sort permitido e page válida", () => {
    const q = parseListQuery(new URLSearchParams("page=3&sort=name&dir=asc&q=%20ana%20"), ["name"]);
    expect(q).toMatchObject({ page: 3, sort: "name", dir: "asc", q: "ana" });
  });
  it("datas inválidas viram null", () => {
    const q = parseListQuery(new URLSearchParams("createdFrom=2026-10-01&createdTo=nope"), []);
    expect(q.createdFrom).toBe("2026-10-01");
    expect(q.createdTo).toBeNull();
  });
});

describe("serializeListQuery", () => {
  it("query padrão serializa vazio", () => {
    expect(serializeListQuery(parseListQuery(new URLSearchParams(""), []))).toBe("");
  });
  it("ida e volta", () => {
    const qs = "q=ana&page=2&sort=name&dir=asc&owner=00000000-0000-4000-8000-00000000000a&owner=00000000-0000-4000-8000-00000000000b&status=open&createdFrom=2026-10-01";
    const q = parseListQuery(new URLSearchParams(qs), ["name"]);
    const again = parseListQuery(new URLSearchParams(serializeListQuery(q)), ["name"]);
    expect(again).toEqual(q);
  });
});
