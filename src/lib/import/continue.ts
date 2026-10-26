// Regras das actions de progresso e simulação, sem dependências de servidor (testáveis com falsos).
import { STEP_LABELS } from "./wizard";

type Counters = Record<string, Record<string, number>>;

export type JobState = { status: string; step: string; counters: Counters };
export type SliceLike = JobState & { done: boolean; busy?: boolean };

export type ContinueResult =
  | { ok: true; status: string; step: string; counters: Counters; done: boolean; busy: boolean }
  | { ok: false; error: string; transient?: boolean };

export const CONTINUE_ERRORS = {
  notFound: "Importação não encontrada.",
  draft: "A importação ainda não foi iniciada.",
};

/**
 * Só roda fatia com o job em running. Pausado, concluído ou com falha: devolve o estado atual sem rodar
 * (o motor também não rodaria, mas assim um rascunho nunca é iniciado por aqui). Rascunho: erro.
 */
export async function continueJob(
  jobId: string,
  deps: { load(id: string): Promise<JobState | null>; run(id: string): Promise<SliceLike> },
): Promise<ContinueResult> {
  const job = await deps.load(jobId);
  if (!job) return { ok: false, error: CONTINUE_ERRORS.notFound };
  if (job.status === "draft") return { ok: false, error: CONTINUE_ERRORS.draft };
  if (job.status !== "running") return { ok: true, ...job, done: true, busy: false };
  const r = await deps.run(jobId);
  return { ok: true, status: r.status, step: r.step, counters: r.counters, done: r.done, busy: r.busy === true };
}

/** Teto da simulação (tempo de relógio): fica abaixo do maxDuration de 60s da página com folga para uma unidade. */
export const SIMULATION_TOTAL_MS = 45_000;
/** Orçamento de cada fatia real chamada pela tela de progresso (mais uma unidade, abaixo dos 60s). */
export const SLICE_BUDGET_MS = 10_000;

export type SimulationRun = JobState & { partial: boolean; message: string | null };

/**
 * Roda fatias de simulação até terminar ou até o teto. Cada fatia recebe só o tempo que resta; a última unidade
 * pode passar um pouco do teto. Parou antes: contadores parciais e "Simulação parcial até a etapa X".
 */
export async function simulateUntil(
  runSlice: (budgetMs: number) => Promise<SliceLike>,
  opts: { totalMs?: number; now?: () => number } = {},
): Promise<SimulationRun> {
  const total = opts.totalMs ?? SIMULATION_TOTAL_MS;
  const now = opts.now ?? Date.now;
  const t0 = now();
  for (;;) {
    const r = await runSlice(Math.max(1, total - (now() - t0)));
    if (r.done) return { status: r.status, step: r.step, counters: r.counters, partial: false, message: null };
    if (now() - t0 >= total) {
      return {
        status: r.status,
        step: r.step,
        counters: r.counters,
        partial: true,
        message: `Simulação parcial até a etapa ${STEP_LABELS[r.step] ?? r.step}`,
      };
    }
  }
}

/** Espera antes da única nova tentativa automática do laço de progresso. */
export const TRANSIENT_RETRY_MS = 3000;

const TRANSIENT_RE =
  /fetch failed|failed to fetch|load failed|networkerror|network error|falha de rede|econnreset|etimedout|socket hang up|respondeu (429|5\d\d)/i;

/** Falha passageira de rede (navegador, servidor ou Pipedrive): vale tentar de novo sozinho. */
export function isTransientError(e: unknown): boolean {
  if (!(e instanceof Error)) return typeof e === "string" && TRANSIENT_RE.test(e);
  const cause = (e as { cause?: unknown }).cause;
  return TRANSIENT_RE.test(e.message) || (cause !== undefined && cause !== e && isTransientError(cause));
}

/**
 * Chama uma vez; em falha passageira (exceção de rede ou resultado marcado como passageiro), espera e tenta
 * mais uma vez. A segunda tentativa vale como está (erro aparece na tela).
 */
export async function withTransientRetry<T>(
  call: () => Promise<T>,
  opts: { isTransient: (r: T) => boolean; sleep?: (ms: number) => Promise<void>; waitMs?: number },
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    const r = await call();
    if (!opts.isTransient(r)) return r;
  } catch (e) {
    if (!isTransientError(e)) throw e;
  }
  await sleep(opts.waitMs ?? TRANSIENT_RETRY_MS);
  return call();
}
