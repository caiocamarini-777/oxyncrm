"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createImportCompany,
  saveMappings,
  simulateImport,
  startImport,
  type SimulationResult,
} from "@/lib/import/actions";
import {
  NATIVE_LABELS,
  STATUS_LABELS,
  fieldKeyFrom,
  norm,
  pipelineTarget,
  stagesFor,
  validateDraft,
  type DiscoveredField,
  type Discovery,
  type DraftMappings,
  type FieldTarget,
  type OxynData,
} from "@/lib/import/wizard";
import { CountersTable, LogList } from "./import-report";

const SELECT = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const STEPS = ["Funis", "Usuários", "Etiquetas", "Padrões", "Campos", "Revisão"] as const;
const NEW_COMPANY = "__nova__";
const IGNORE = "__ignorar__";

const ENTITY_TITLES: Record<DiscoveredField["entity"], string> = {
  deals: "Campos de negócio",
  persons: "Campos de pessoa",
  organizations: "Campos de organização",
};
const ENTITY_WORDS: Record<DiscoveredField["entity"], string> = { deals: "negócio", persons: "pessoa", organizations: "organização" };

export function ImportWizard({
  jobId,
  discovery,
  oxyn,
  initial,
}: {
  jobId: string;
  discovery: Discovery;
  oxyn: OxynData;
  initial: DraftMappings;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftMappings>(initial);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [extraCompanies, setExtraCompanies] = useState<{ id: string; name: string }[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [pending, startTransition] = useTransition();

  const companies = useMemo(() => {
    const known = new Set(oxyn.companies.map((c) => c.id));
    return [...oxyn.companies, ...extraCompanies.filter((c) => !known.has(c.id))].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [oxyn.companies, extraCompanies]);
  const problems = useMemo(() => validateDraft(draft, discovery), [draft, discovery]);

  function update(fn: (d: DraftMappings) => void) {
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setSimulation(null);
  }

  async function save(d = draft): Promise<boolean> {
    const r = await saveMappings(jobId, d);
    if (!r.ok) setError(r.error);
    return r.ok;
  }

  function go(to: number) {
    setError(null);
    startTransition(async () => {
      if (await save()) setStep(to);
    });
  }

  function chooseCompany(pdId: string, name: string, value: string) {
    if (value !== NEW_COMPANY) {
      update((d) => {
        d.pipelines[pdId] = pipelineTarget(pdId, value, discovery, oxyn);
      });
      return;
    }
    setError(null);
    setCreating(pdId);
    startTransition(async () => {
      const r = await createImportCompany(name);
      setCreating(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setExtraCompanies((list) => [...list, r.data]);
      const next = structuredClone(draft);
      next.pipelines[pdId] = pipelineTarget(pdId, r.data.id, discovery, oxyn);
      setDraft(next);
      await save(next);
      router.refresh();
    });
  }

  function simulate() {
    setError(null);
    setSimulation(null);
    startTransition(async () => {
      if (!(await save())) return;
      const r = await simulateImport(jobId);
      if (!r.ok) setError(r.error);
      else setSimulation(r.data);
    });
  }

  function start() {
    setError(null);
    startTransition(async () => {
      if (!(await save())) return;
      const r = await startImport(jobId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? "";
  const profileName = (id: string) => oxyn.profiles.find((p) => p.id === id)?.name ?? "";

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Passos da importação" className="flex flex-wrap gap-1">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            disabled={pending}
            aria-current={i === step ? "step" : undefined}
            onClick={() => go(i)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted",
              i === step && "bg-muted font-medium text-brand",
            )}
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-semibold">Funis</h2>
          <p className="text-sm text-muted-foreground">
            Cada funil do Pipedrive vai para uma empresa. Escolha um funil existente (as etapas são casadas pelo nome) ou deixe
            o Oxyn criar um funil com o mesmo nome e as mesmas etapas.
          </p>
          {discovery.pipelines.length === 0 && <p className="text-sm text-muted-foreground">Nenhum funil no Pipedrive.</p>}
          {discovery.pipelines.map((p) => {
            const name = p.name.trim();
            const ignored = draft.ignorePipelines.includes(p.id);
            const pm = draft.pipelines[p.id] ?? { companyId: "", pipelineId: null, stages: {} };
            const companyPipes = oxyn.pipelines.filter((x) => x.companyId === pm.companyId);
            const target = companyPipes.find((x) => x.id === pm.pipelineId);
            const pdStages = discovery.stages.filter((s) => s.pipelineId === p.id);
            const sameName = companies.some((c) => norm(c.name) === norm(name));
            return (
              <fieldset key={p.id} className="flex flex-col gap-3 rounded-md border p-3">
                <legend className="px-1 font-medium">{name}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`acao-${p.id}`}>Ação</Label>
                    <select
                      id={`acao-${p.id}`}
                      aria-label={`Ação para ${name}`}
                      className={SELECT}
                      value={ignored ? "ignorar" : "importar"}
                      onChange={(e) =>
                        update((d) => {
                          d.ignorePipelines = d.ignorePipelines.filter((x) => x !== p.id);
                          if (e.target.value === "ignorar") d.ignorePipelines.push(p.id);
                        })
                      }
                    >
                      <option value="importar">Importar</option>
                      <option value="ignorar">Ignorar (negócios deste funil não entram)</option>
                    </select>
                  </div>
                  {!ignored && (
                    <>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`empresa-${p.id}`}>Empresa de destino</Label>
                        <select
                          id={`empresa-${p.id}`}
                          aria-label={`Empresa de destino de ${name}`}
                          className={SELECT}
                          disabled={creating === p.id}
                          value={creating === p.id ? NEW_COMPANY : pm.companyId}
                          onChange={(e) => chooseCompany(p.id, name, e.target.value)}
                        >
                          <option value="">Escolha a empresa</option>
                          {companies.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                          {(!sameName || creating === p.id) && <option value={NEW_COMPANY}>{`Criar empresa "${name}"`}</option>}
                        </select>
                        {creating === p.id && <span className="text-xs text-muted-foreground">Criando empresa...</span>}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`funil-${p.id}`}>Funil de destino</Label>
                        <select
                          id={`funil-${p.id}`}
                          aria-label={`Funil de destino de ${name}`}
                          className={SELECT}
                          disabled={!pm.companyId}
                          value={pm.pipelineId ?? ""}
                          onChange={(e) =>
                            update((d) => {
                              const id = e.target.value || null;
                              const t = oxyn.pipelines.find((x) => x.id === id);
                              d.pipelines[p.id] = { companyId: pm.companyId, pipelineId: id, stages: stagesFor(p.id, discovery, t) };
                            })
                          }
                        >
                          <option value="">{`Criar funil "${name}"`}</option>
                          {companyPipes.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
                {!ignored && pm.companyId && !target && (
                  <p className="text-sm text-muted-foreground">
                    {pdStages.length
                      ? `Etapas criadas na ordem do Pipedrive: ${pdStages.map((s) => s.name).join(", ")}. Se já existir um funil "${name}" na empresa, ele é reaproveitado.`
                      : "Funil sem etapas no Pipedrive."}
                  </p>
                )}
                {!ignored && target && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-muted-foreground">Etapas: negócios numa etapa sem destino viram erro no relatório.</p>
                    {pdStages.map((s) => (
                      <div key={s.id} className="grid items-center gap-2 sm:grid-cols-[1fr_1fr]">
                        <span className="text-sm">{s.name}</span>
                        <select
                          aria-label={`Etapa de destino de ${s.name} (${name})`}
                          className={SELECT}
                          value={pm.stages[s.id] ?? ""}
                          onChange={(e) =>
                            update((d) => {
                              d.pipelines[p.id].stages[s.id] = e.target.value || null;
                            })
                          }
                        >
                          <option value="">Sem destino</option>
                          {target.stages.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </fieldset>
            );
          })}
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-semibold">Usuários</h2>
          <p className="text-sm text-muted-foreground">
            Donos de registros do Pipedrive viram usuários do Oxyn. O casamento é pelo e-mail; sem correspondência, o dono
            padrão é usado. O dono de cada negócio e lead precisa ter acesso à empresa de destino.
          </p>
          <div className="flex flex-col divide-y rounded-md border">
            {discovery.users.map((u) => (
              <div key={u.id} className="grid items-center gap-2 p-3 sm:grid-cols-[1fr_1fr]">
                <div className="min-w-0 text-sm">
                  <div className="font-medium">
                    {u.name}
                    {!u.active && <span className="ml-2 text-xs font-normal text-muted-foreground">(inativo)</span>}
                  </div>
                  <div className="truncate text-muted-foreground">{u.email}</div>
                </div>
                <select
                  aria-label={`Usuário do Oxyn para ${u.name}`}
                  className={SELECT}
                  value={draft.users[u.id] ?? ""}
                  onChange={(e) =>
                    update((d) => {
                      if (e.target.value) d.users[u.id] = e.target.value;
                      else delete d.users[u.id];
                    })
                  }
                >
                  <option value="">Usar o dono padrão</option>
                  {oxyn.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.email})
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-semibold">Etiquetas de lead</h2>
          <p className="text-sm text-muted-foreground">
            Leads não têm funil. A etiqueta indica a empresa do lead; etiquetas sem empresa viram etiquetas comuns no lead.
            Lead sem etiqueta de empresa vai para a empresa padrão.
          </p>
          <div className="flex flex-col divide-y rounded-md border">
            {discovery.labels.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nenhuma etiqueta no Pipedrive.</p>}
            {discovery.labels.map((l) => (
              <div key={l.id} className="grid items-center gap-2 p-3 sm:grid-cols-[1fr_1fr]">
                <span className="text-sm font-medium">{l.name}</span>
                <select
                  aria-label={`Empresa da etiqueta ${l.name}`}
                  className={SELECT}
                  value={draft.leadLabelCompany[l.id] ?? ""}
                  onChange={(e) =>
                    update((d) => {
                      if (e.target.value) d.leadLabelCompany[l.id] = e.target.value;
                      else delete d.leadLabelCompany[l.id];
                    })
                  }
                >
                  <option value="">Nenhuma (etiqueta comum)</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-semibold">Padrões</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="empresa-padrao">Empresa padrão</Label>
              <select
                id="empresa-padrao"
                className={SELECT}
                value={draft.defaultCompanyId}
                onChange={(e) => update((d) => void (d.defaultCompanyId = e.target.value))}
              >
                <option value="">Escolha a empresa</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Recebe contatos sem negócio ou lead, leads sem etiqueta de empresa e produtos.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dono-padrao">Dono padrão</Label>
              <select
                id="dono-padrao"
                className={SELECT}
                value={draft.fallbackOwnerId}
                onChange={(e) => update((d) => void (d.fallbackOwnerId = e.target.value))}
              >
                <option value="">Escolha o usuário</option>
                {oxyn.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.email})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Usado quando o dono do Pipedrive não tem usuário mapeado. Precisa ter acesso a todas as empresas de destino.
              </p>
            </div>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-semibold">Campos personalizados</h2>
          <p className="text-sm text-muted-foreground">
            Setup, MRR e prazo podem ir para os campos nativos do negócio. Os demais viram campos personalizados (criados ou
            reaproveitados pela chave) ou são ignorados.
          </p>
          {discovery.fields.length === 0 && <p className="text-sm text-muted-foreground">Nenhum campo personalizado no Pipedrive.</p>}
          {(["deals", "persons", "organizations"] as const).map((entity) => {
            const list = discovery.fields.filter((f) => f.entity === entity);
            if (!list.length) return null;
            return (
              <div key={entity} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{ENTITY_TITLES[entity]}</h3>
                <div className="flex flex-col divide-y rounded-md border">
                  {list.map((f) => {
                    const dup = discovery.fields.filter((x) => x.name === f.name).length > 1;
                    const label = dup ? `${f.name} (${ENTITY_WORDS[entity]})` : f.name;
                    const t = draft.customFields[f.key];
                    return (
                      <div key={f.key} className="grid items-center gap-2 p-3 sm:grid-cols-[1fr_1fr_1fr]">
                        <div className="text-sm">
                          <div className="font-medium">{f.name}</div>
                          <div className="text-xs text-muted-foreground">{f.type}</div>
                        </div>
                        <select
                          aria-label={`Destino do campo ${label}`}
                          className={SELECT}
                          value={t?.target ?? IGNORE}
                          onChange={(e) =>
                            update((d) => {
                              const v = e.target.value;
                              if (v === IGNORE) delete d.customFields[f.key];
                              else if (v === "custom")
                                d.customFields[f.key] = { target: "custom", customFieldKey: t?.customFieldKey || fieldKeyFrom(f.name) };
                              else d.customFields[f.key] = { target: v as FieldTarget };
                            })
                          }
                        >
                          <option value={IGNORE}>Ignorar</option>
                          <option value="custom">Campo personalizado</option>
                          {entity === "deals" &&
                            Object.entries(NATIVE_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>
                                {`Nativo: ${l}`}
                              </option>
                            ))}
                        </select>
                        {t?.target === "custom" ? (
                          <Input
                            aria-label={`Chave do campo ${label}`}
                            value={t.customFieldKey ?? ""}
                            onChange={(e) =>
                              update((d) => {
                                d.customFields[f.key] = { target: "custom", customFieldKey: e.target.value.trim() };
                              })
                            }
                          />
                        ) : (
                          <span />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {step === 5 && (
        <section className="flex flex-col gap-4">
          <h2 className="font-heading text-lg font-semibold">Revisão</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {discovery.pipelines.map((p) => {
              const pm = draft.pipelines[p.id];
              const text = draft.ignorePipelines.includes(p.id)
                ? "ignorado"
                : pm?.companyId
                  ? `${companyName(pm.companyId)}, ${pm.pipelineId ? (oxyn.pipelines.find((x) => x.id === pm.pipelineId)?.name ?? "funil existente") : "funil novo"}`
                  : "sem destino";
              return (
                <li key={p.id}>
                  Funil {p.name.trim()}: {text}
                </li>
              );
            })}
            <li>
              Usuários mapeados: {Object.keys(draft.users).length} de {discovery.users.length}
            </li>
            <li>Etiquetas de empresa: {Object.keys(draft.leadLabelCompany).length}</li>
            <li>Empresa padrão: {companyName(draft.defaultCompanyId) || "não escolhida"}</li>
            <li>Dono padrão: {profileName(draft.fallbackOwnerId) || "não escolhido"}</li>
            <li>
              Campos: {Object.keys(draft.customFields).length} de {discovery.fields.length} importados
            </li>
          </ul>
          {problems.length ? (
            <div role="alert" className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Antes de iniciar:</p>
              <ul className="list-disc pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-brand">Tudo pronto para iniciar.</p>
          )}
          <p className="text-sm text-muted-foreground">
            A simulação lê o Pipedrive e mapeia tudo sem gravar nada. A importação pode ser pausada e retomada, e rodar de novo
            não duplica registros.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending || problems.length > 0} onClick={simulate}>
              Simular (sem gravar)
            </Button>
            <Button type="button" disabled={pending || problems.length > 0} onClick={start}>
              Iniciar importação
            </Button>
          </div>
          {pending && !creating && <p className="text-sm text-muted-foreground">Processando...</p>}
          {simulation && (
            <div data-testid="simulation" className="flex flex-col gap-3 rounded-md border p-3">
              <p className="font-medium">
                {simulation.status === "done"
                  ? "Simulação concluída"
                  : `Simulação terminou com status: ${STATUS_LABELS[simulation.status] ?? simulation.status}`}
              </p>
              <CountersTable counters={simulation.counters} />
              <LogList
                items={simulation.logs}
                total={simulation.logTotal}
                title="Erros e avisos da simulação"
                emptyText="Nenhum erro ou aviso."
                testId="simulation-log"
              />
            </div>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2 border-t pt-4">
        <Button type="button" variant="outline" disabled={pending || step === 0} onClick={() => go(step - 1)}>
          Voltar
        </Button>
        {step < STEPS.length - 1 && (
          <Button type="button" disabled={pending} onClick={() => go(step + 1)}>
            Próximo
          </Button>
        )}
      </div>
    </div>
  );
}
