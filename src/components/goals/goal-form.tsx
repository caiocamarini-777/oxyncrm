"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createGoal } from "@/lib/reports/actions";
import { GOAL_METRICS, GOAL_METRIC_LABELS, GOAL_PERIODS, alignStart, type GoalPeriod } from "@/lib/reports/goals";

type Option = { value: string; label: string };

const PERIOD_OPTIONS: Record<GoalPeriod, string> = { week: "Semanal", month: "Mensal", quarter: "Trimestral" };
const TARGET_OPTIONS = [
  { value: "company", label: "Empresa" },
  { value: "user", label: "Usuário" },
  { value: "team", label: "Equipe" },
] as const;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Nova meta. Só o admin geral vê este formulário (a página decide e o banco confirma). */
export function GoalForm({
  companies,
  defaultCompanyId,
  membersByCompany,
  teams,
  today,
}: {
  companies: Option[];
  /** Empresa pré-selecionada (escopo de uma empresa); vazio no escopo "Todas as empresas". */
  defaultCompanyId: string | null;
  membersByCompany: Record<string, Option[]>;
  teams: Option[];
  /** Hoje em São Paulo (AAAA-MM-DD), vindo do servidor. */
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const initialCompany = defaultCompanyId ?? "";
  const [companyId, setCompanyId] = useState(initialCompany);
  const [targetKind, setTargetKind] = useState<"company" | "user" | "team">("company");
  const [userId, setUserId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [metric, setMetric] = useState<(typeof GOAL_METRICS)[number]>("won_value");
  const [period, setPeriod] = useState<GoalPeriod>("month");
  const [startsOn, setStartsOn] = useState(alignStart(today, "month"));
  const [value, setValue] = useState("");

  function reset() {
    setCompanyId(initialCompany);
    setTargetKind("company");
    setUserId("");
    setTeamId("");
    setMetric("won_value");
    setPeriod("month");
    setStartsOn(alignStart(today, "month"));
    setValue("");
    setError(null);
    setFieldErrors({});
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const n = Number(value.replace(",", "."));
    startTransition(async () => {
      const res = await createGoal({
        companyId,
        targetKind,
        targetUserId: targetKind === "user" ? userId || null : null,
        targetTeamId: targetKind === "team" ? teamId || null : null,
        metric,
        period,
        startsOn,
        targetValue: value.trim() === "" || !Number.isFinite(n) ? Number.NaN : n,
      });
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        setError(res.fieldErrors ? null : res.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  const members = membersByCompany[companyId] ?? [];
  const err = (k: string) => fieldErrors[k];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Nova meta</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nova meta</DialogTitle>
            <DialogDescription>A meta vale para o período corrente e se renova a cada período.</DialogDescription>
          </DialogHeader>

          <Field id="goal-company" label="Empresa" error={err("companyId")}>
            <select
              id="goal-company"
              className={selectClass}
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setUserId("");
              }}
            >
              <option value="">Escolha a empresa</option>
              {companies.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field id="goal-target" label="Alvo" error={err("targetKind")}>
            <select
              id="goal-target"
              className={selectClass}
              value={targetKind}
              onChange={(e) => setTargetKind(e.target.value as typeof targetKind)}
            >
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {targetKind === "user" ? (
            <Field id="goal-user" label="Usuário" error={err("targetUserId")}>
              <select id="goal-user" className={selectClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Escolha a pessoa</option>
                {members.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {targetKind === "team" ? (
            <Field id="goal-team" label="Equipe" error={err("targetTeamId")}>
              <select id="goal-team" className={selectClass} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Escolha a equipe</option>
                {teams.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field id="goal-metric" label="Métrica" error={err("metric")}>
            <select
              id="goal-metric"
              className={selectClass}
              value={metric}
              onChange={(e) => setMetric(e.target.value as typeof metric)}
            >
              {GOAL_METRICS.map((m) => (
                <option key={m} value={m}>
                  {GOAL_METRIC_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field id="goal-period" label="Período" error={err("period")}>
              <select
                id="goal-period"
                className={selectClass}
                value={period}
                onChange={(e) => {
                  const p = e.target.value as GoalPeriod;
                  setPeriod(p);
                  setStartsOn(alignStart(startsOn, p));
                }}
              >
                {GOAL_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_OPTIONS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="goal-start" label="Início" error={err("startsOn")}>
              <Input
                id="goal-start"
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(alignStart(e.target.value, period))}
              />
            </Field>
          </div>

          <Field id="goal-value" label="Valor-alvo" error={err("targetValue")}>
            <Input
              id="goal-value"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={err("targetValue") ? true : undefined}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : "Criar meta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
