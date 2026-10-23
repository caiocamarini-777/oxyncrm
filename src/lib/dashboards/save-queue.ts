/**
 * Fila de salvamentos: cada tarefa roda depois da anterior. Quando uma falha (devolve false ou lança), as que
 * já estavam na fila são descartadas, porque levam layouts mais velhos que o que foi desfeito; as enfileiradas
 * depois da falha rodam normalmente.
 */
export class SaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;

  /** `run` devolve true se salvou. `onSkip` roda quando a tarefa é descartada. */
  enqueue(run: () => Promise<boolean>, onDone?: (outcome: "saved" | "failed" | "skipped") => void): void {
    const mine = this.epoch;
    this.tail = this.tail.then(async () => {
      if (mine !== this.epoch) return onDone?.("skipped");
      let ok = false;
      try {
        ok = await run();
      } catch {
        ok = false;
      }
      if (!ok) this.epoch += 1;
      onDone?.(ok ? "saved" : "failed");
    });
  }

  /** Espera tudo o que está na fila (para testes). */
  idle(): Promise<unknown> {
    return this.tail;
  }
}
