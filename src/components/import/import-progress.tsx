"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { continueImport, createImportJob, pauseImport, resumeImport, reviseImport } from "@/lib/import/actions";
import { usersCheckPairs } from "@/lib/import/constants";
import { withTransientRetry } from "@/lib/import/continue";
import { STATUS_LABELS, STEP_LABELS } from "@/lib/import/wizard";
import { CountersTable, LogList, type LogEntry } from "./import-report";

type Counters = Record<string, Record<string, number>>;

export type ProgressJob = {
  id: string;
  status: string;
  step: string | null;
  counters: Counters;
  errors: LogEntry[];
  warnings: LogEntry[];
};

const STEP_ORDER = Object.keys(STEP_LABELS);
const BUSY_WAIT_MS = 3000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function ImportProgress({ job }: { job: ProgressJob }) {
  const router = useRouter();
  const [status, setStatus] = useState(job.status);
  const [step, setStep] = useState(job.step);
  const [counters, setCounters] = useState<Counters>(job.counters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [looping, setLooping] = useState(false);
  const [pending, startTransition] = useTransition();
  const loopRef = useRef(false);
  // as actions do cliente rodam em fila: a pausa só chega ao servidor depois da fatia em curso
  const pauseRequested = useRef(false);
  const mounted = useRef(true);

  // o servidor manda o estado gravado (log e contadores) a cada refresh; durante o laço vale o da última fatia
  const [prevJob, setPrevJob] = useState(job);
  if (prevJob !== job) {
    setPrevJob(job);
    if (!looping) {
      setStatus(job.status);
      setStep(job.step);
      setCounters(job.counters);
    }
  }

  const loop = useCallback(async () => {
    if (loopRef.current) return;
    loopRef.current = true;
    setLooping(true);
    setError(null);
    try {
      while (mounted.current) {
        // falha passageira de rede: uma nova tentativa sozinha depois de 3 s antes de mostrar o erro
        const r = await withTransientRetry(() => continueImport(job.id), {
          isTransient: (x) => !x.ok && x.transient === true,
        });
        if (!mounted.current) break;
        if (!r.ok) {
          setError(r.error);
          break;
        }
        setStatus(pauseRequested.current && r.status === "running" ? "paused" : r.status);
        setStep(r.step);
        setCounters(r.counters);
        setBusy(r.busy);
        if (pauseRequested.current) break;
        router.refresh();
        if (r.busy) {
          await sleep(BUSY_WAIT_MS);
          continue;
        }
        if (r.done) break;
      }
    } catch {
      if (mounted.current) setError("A conexão com o servidor caiu. Clique em Retomar para continuar de onde parou.");
    } finally {
      loopRef.current = false;
      if (mounted.current) {
        setLooping(false);
        setBusy(false);
        // com pausa pedida, quem atualiza é a action de pausa (ainda na fila)
        if (!pauseRequested.current) router.refresh();
      }
    }
  }, [job.id, router]);

  useEffect(() => {
    mounted.current = true;
    // aberta (ou recarregada) com a importação em andamento: continua de onde parou
    const t = setTimeout(() => {
      if (job.status === "running") void loop();
    }, 0);
    return () => {
      clearTimeout(t);
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao montar
  }, []);

  function pause() {
    setError(null);
    pauseRequested.current = true;
    setStatus("paused");
    startTransition(async () => {
      const r = await pauseImport(job.id);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function resume() {
    setError(null);
    startTransition(async () => {
      if (status === "paused") {
        const r = await resumeImport(job.id);
        if (!r.ok) {
          setError(r.error);
          return;
        }
      }
      pauseRequested.current = false;
      setStatus("running");
      void loop();
    });
  }

  function revise() {
    startTransition(async () => {
      const r = await reviseImport(job.id);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function again() {
    startTransition(async () => {
      const r = await createImportJob(job.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/configuracoes/importacao/${r.data.id}`);
    });
  }

  const jobErrors = job.errors.filter((e) => e.entity === "job");
  const totalErrors = Object.values(counters).reduce((n, c) => n + (Number(c?.errors) || 0), 0);
  const totalWarnings = Object.values(counters).reduce((n, c) => n + (Number(c?.warnings) || 0), 0);
  const stepIndex = step ? STEP_ORDER.indexOf(step) : 0;
  const pausing = status === "paused" && looping;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          data-testid="import-status"
          variant={status === "failed" ? "destructive" : status === "done" ? "default" : "secondary"}
        >
          {STATUS_LABELS[status] ?? status}
        </Badge>
        {status !== "done" && step && (
          <span className="text-sm text-muted-foreground">
            Etapa {Math.max(1, stepIndex + 1)} de {STEP_ORDER.length - 1}: {STEP_LABELS[step] ?? step}
          </span>
        )}
        {busy && <span className="text-sm text-muted-foreground">Outra execução está processando esta importação. Aguardando...</span>}
        {pausing && <span className="text-sm text-muted-foreground">Pausando ao fim da página atual...</span>}
        <div className="ml-auto flex gap-2">
          {status === "running" && (
            <Button type="button" variant="outline" disabled={pending} onClick={pause}>
              Pausar
            </Button>
          )}
          {(status === "paused" || (status === "running" && !looping)) && (
            <Button type="button" disabled={pending || looping} onClick={resume}>
              Retomar
            </Button>
          )}
          {status === "failed" && (
            <Button type="button" variant="outline" disabled={pending} onClick={revise}>
              Revisar mapeamentos
            </Button>
          )}
          {(status === "done" || status === "failed") && (
            <Button type="button" variant="outline" disabled={pending} onClick={again}>
              Importar de novo
            </Button>
          )}
        </div>
      </div>

      {status === "running" && (
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${Math.round((Math.max(0, stepIndex) / (STEP_ORDER.length - 1)) * 100)}%` }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {status === "failed" && jobErrors.length > 0 && (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">A importação parou.</p>
          {jobErrors.map((e, i) => {
            const pairs = usersCheckPairs(e.reason);
            if (!pairs) return <p key={i}>{e.reason}</p>;
            return (
              <div key={i} className="flex flex-col gap-1">
                <p>Estes usuários não têm acesso ativo à empresa de destino dos registros deles:</p>
                <ul data-testid="users-check-pairs" className="list-disc pl-5">
                  {pairs.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="text-muted-foreground">
                  Dê acesso a esses usuários nas empresas indicadas (Configurações, Usuários) ou mapeie os donos para outra
                  pessoa, e então clique em Revisar mapeamentos.
                </p>
              </div>
            );
          })}
        </div>
      )}

      <CountersTable counters={counters} />

      {status === "done" && (
        <p className="text-sm text-muted-foreground">
          Importação concluída com {totalErrors} {totalErrors === 1 ? "erro" : "erros"} e {totalWarnings}{" "}
          {totalWarnings === 1 ? "aviso" : "avisos"}.
        </p>
      )}

      <LogList items={job.errors} total={totalErrors} title="Erros" emptyText="Nenhum erro." testId="import-errors" />
      <LogList items={job.warnings} total={totalWarnings} title="Avisos" emptyText="Nenhum aviso." testId="import-warnings" />
    </div>
  );
}
