import { describe, expect, it } from "vitest";
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
});
