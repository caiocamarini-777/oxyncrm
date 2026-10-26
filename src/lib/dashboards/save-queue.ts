/**
 * Fila de salvamentos: cada tarefa roda depois da anterior. Quando uma falha (devolve false ou lança), as que
 * já estavam na fila são descartadas, porque levam layouts mais velhos que o que foi desfeito; as enfileiradas
 * depois da falha rodam normalmente.
 */
type Outcome = "saved" | "failed" | "skipped";

/** Chama o callback sem deixar um erro dele rejeitar a cadeia (o que pararia a fila de vez). */
function notify(onDone: ((outcome: Outcome) => void) | undefined, outcome: Outcome): void {
  try {
    onDone?.(outcome);
  } catch (error) {
    console.error("[dashboards] callback da fila de salvamento falhou:", error);
  }
}

export class SaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;

  /** `run` devolve true se salvou. `onSkip` roda quando a tarefa é descartada. */
  enqueue(run: () => Promise<boolean>, onDone?: (outcome: Outcome) => void): void {
    const mine = this.epoch;
    this.tail = this.tail.then(async () => {
      if (mine !== this.epoch) return notify(onDone, "skipped");
      let ok = false;
      try {
        ok = await run();
      } catch {
        ok = false;
      }
      if (!ok) this.epoch += 1;
      notify(onDone, ok ? "saved" : "failed");
    });
  }

  /** Espera tudo o que está na fila (para testes). */
  idle(): Promise<unknown> {
    return this.tail;
  }
}
