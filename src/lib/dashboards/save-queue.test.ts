import { describe, expect, it, vi } from "vitest";
import { SaveQueue } from "./save-queue";

describe("SaveQueue", () => {
  it("roda em ordem", async () => {
    const q = new SaveQueue();
    const log: number[] = [];
    for (const n of [1, 2, 3]) {
      q.enqueue(async () => {
        await new Promise((r) => setTimeout(r, 4 - n));
        log.push(n);
        return true;
      });
    }
    await q.idle();
    expect(log).toEqual([1, 2, 3]);
  });

  it("descarta os que esperavam atrás de uma falha, mas aceita os novos", async () => {
    const q = new SaveQueue();
    const log: string[] = [];
    const outcomes: string[] = [];
    q.enqueue(async () => {
      log.push("a");
      return false;
    }, (o) => outcomes.push(o));
    q.enqueue(async () => {
      log.push("b");
      return true;
    }, (o) => outcomes.push(o));
    q.enqueue(async () => {
      log.push("c");
      throw new Error("x");
    }, (o) => outcomes.push(o));
    await q.idle();
    q.enqueue(async () => {
      log.push("d");
      return true;
    }, (o) => outcomes.push(o));
    await q.idle();
    expect(log).toEqual(["a", "d"]);
    expect(outcomes).toEqual(["failed", "skipped", "skipped", "saved"]);
  });

  it("um callback que lança não trava a fila", async () => {
    const q = new SaveQueue();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log: string[] = [];
    q.enqueue(async () => {
      log.push("a");
      return true;
    }, () => {
      throw new Error("callback quebrado");
    });
    q.enqueue(async () => {
      log.push("b");
      return true;
    }, (o) => log.push(o));
    await expect(q.idle()).resolves.toBeUndefined();
    expect(log).toEqual(["a", "b", "saved"]);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
