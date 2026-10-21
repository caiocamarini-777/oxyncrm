import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllEnvs());

describe("sendEmail transport", () => {
  it("em produção sem EMAIL_TRANSPORT lança erro", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_TRANSPORT", "");
    const { sendEmail } = await import("./send");
    await expect(sendEmail({ to: "a@b.c", subject: "s", html: "h", text: "t" })).rejects.toThrow(
      "EMAIL_TRANSPORT não configurado",
    );
  });
  it("fora de produção o padrão é file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "outbox-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("EMAIL_TRANSPORT", "");
    const { sendEmail } = await import("./send");
    await sendEmail({ to: "a@b.c", subject: "s", html: "h", text: "t" });
    const line = await readFile(path.join(dir, ".e2e-outbox", "emails.jsonl"), "utf8");
    expect(JSON.parse(line).to).toBe("a@b.c");
    vi.restoreAllMocks();
  });
});
