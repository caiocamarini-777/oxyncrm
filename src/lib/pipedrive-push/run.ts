/**
 * Rodada da atualização do Pipedrive pelo CRM (piloto pós-virada). Copia para o Pipedrive o que foi criado, mudado
 * ou apagado no CRM desde o cursor da última rodada completa.
 *
 * Não roda com a rotina desligada nem com o modo espelho ativo (`skipped`: nada é lido nem enviado). Quando roda:
 *
 * 1. **Fila de retry**, na ordem das dependências (organizações → anotações). O registro fora da lixeira é enviado de
 *    novo; o que foi para a lixeira (ou não existe mais) é apagado no Pipedrive, se tinha vínculo.
 * 2. **Exclusões** desde o cursor, na ordem inversa (anotações → organizações): `del` e `unlink`.
 * 3. **Mudanças** desde o cursor, na ordem organizações → anotações. Sem id no Pipedrive: POST e vínculo. Com id: PUT
 *    (lead: PATCH). Id que não existe mais lá (404/410 na atualização) é criado de novo e religado.
 *
 * **Relacionado sem id no Pipedrive.** Antes de desistir do registro, a rodada cria sob demanda os relacionados que
 * ainda não estão lá (ex.: a pessoa do negócio criada no CRM antes do cursor e que não mudou depois), até dois níveis
 * (negócio → pessoa → organização), e tenta o registro mais uma vez.
 *
 * As exclusões vêm antes das mudanças porque `deleted` não devolve o `deleted_at`: se o tempo acabar no meio das
 * mudanças, as exclusões já foram todas feitas e o cursor pode andar pelo `updated_at` das mudanças (ver
 * `safeCursor`). Os dois conjuntos não se cruzam (mudança é só fora da lixeira).
 *
 * **Falhas.** A falha de um registro não para a rodada: ele vai para a fila de retry e, na quinta falha, sai da fila e
 * fica só no relatório. O relacionado criado sob demanda que falha também entra na fila, com o próprio erro. Registro
 * que continua sem o relacionado (ex.: a pessoa do negócio falhou) vai para a fila sem contar como erro: a fila anda na
 * ordem das dependências, então ele é tentado depois do relacionado. Token inválido (`PipedriveAuthError`) ou falha do
 * banco param a rodada (`failed`) sem mexer no cursor.
 *
 * **Cursor.** Rodada concluída dentro do tempo: o início da rodada menos `CURSOR_OVERLAP_MS`. Tempo esgotado: ver
 * `safeCursor`, também menos a sobreposição. O cursor nunca fica antes do cursor de entrada.
 */
import { PipedriveAuthError, PipedriveError, type PipedriveClient } from "@/lib/import/pipedrive/client";
import {
  toPdActivity,
  toPdDeal,
  toPdLead,
  toPdNote,
  toPdOrganization,
  toPdPerson,
  type PushCtx,
  type PushEntity,
  type PushPayload,
} from "./mapping";
import { isPushEntity, PUSH_ORDER, PUSH_REFS, type PushStore } from "./store";

export type PushCounters = { created: number; updated: number; deleted: number; errors: number };

export type PushReport = {
  status: "done" | "failed" | "skipped";
  /** Por que não rodou, por que falhou ou por que parou antes do fim (tempo esgotado). */
  reason?: string;
  counters: Record<PushEntity, PushCounters>;
  errors: { entity: string; id: string; reason: string }[];
};

export type PushDeps = {
  client: Pick<PipedriveClient, "post" | "put" | "patch" | "del">;
  store: PushStore;
  now(): Date;
  log?: (m: string) => void;
};

/** Falhas de um registro até ele sair da fila de retry e ficar só no relatório. */
export const MAX_ATTEMPTS = 5;
/** Erros guardados no relatório de uma rodada (os contadores seguem contando). */
export const MAX_REPORT_ERRORS = 500;
/** Linhas por página na leitura das mudanças (o teto de `changed` é 1000). */
const PAGE = 500;
/** Atualização num id que não existe mais no Pipedrive (apagado lá). */
const GONE = new Set([404, 410]);
/** Mensagem de `pdRef` (mapping.ts) quando o registro relacionado ainda não foi criado no Pipedrive. */
const WAITING_DEPENDENCY = /ainda sem id no Pipedrive/;
/** Níveis de relacionados criados sob demanda a partir do registro enviado (negócio → pessoa → organização). */
export const MAX_DEPENDENCY_DEPTH = 2;
/**
 * A próxima rodada relê o que mudou nos últimos 2 minutos antes do cursor: cobre a diferença entre o relógio da
 * rodada e o do banco e a transação que gravou `updated_at` antes do início da rodada mas só terminou depois da
 * leitura. Reenviar um registro já vinculado é só um PUT de novo.
 */
export const CURSOR_OVERLAP_MS = 2 * 60_000;

const PATHS: Record<PushEntity, string> = {
  organizations: "/v1/organizations",
  persons: "/v1/persons",
  leads: "/v1/leads",
  deals: "/v1/deals",
  activities: "/v1/activities",
  notes: "/v1/notes",
};

type Row = Record<string, unknown>;

const CONVERT: Record<PushEntity, (row: Row, ctx: PushCtx) => PushPayload> = {
  organizations: toPdOrganization,
  persons: toPdPerson,
  leads: toPdLead,
  deals: toPdDeal,
  activities: toPdActivity,
  notes: toPdNote,
};

/** Resultado de um registro: o que foi feito (null: nada a fazer) ou a falha. */
type Outcome = { done: "created" | "updated" | "deleted" | null } | { failed: string; waiting?: boolean };

/** Falha do Pipedrive num registro: vira falha do registro, sem parar a rodada. */
class RecordFailure extends Error {}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Chamada ao Pipedrive de um registro: token inválido para a rodada; o resto é falha do registro. */
async function pd<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof PipedriveAuthError) throw e;
    throw new RecordFailure(messageOf(e));
  }
}

/** Id do registro criado, do `data` devolvido pelo POST (número; uuid nos leads). */
function createdId(data: unknown): string | null {
  const id = data && typeof data === "object" ? (data as Row).id : null;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Timestamp do banco em microssegundos, para comparar sem perder precisão (o `Date` para nos milissegundos e o
 * PostgREST devolve até 6 casas). NaN se não for uma data.
 */
function micros(ts: string): number {
  const fraction = /\.(\d+)/.exec(ts);
  const seconds = Date.parse(fraction ? ts.replace(fraction[0], "") : ts);
  return seconds * 1000 + (fraction ? Number(fraction[1].padEnd(6, "0").slice(0, 6)) : 0);
}

type Pending = { entity: PushEntity; row: Row; at: string };

/**
 * Cursor de uma rodada que parou por tempo no meio das mudanças. As mudanças de todas as entidades são lidas antes de
 * começar, então se sabe tudo o que ficou de fora. O cursor vira o `updated_at` do último registro concluído que
 * ainda fica abaixo de todos os que ficaram de fora: o maior `updated_at` concluído menor que o menor deles. Como a
 * rodada anda por entidade, esse é o ponto seguro mais baixo, e pode ficar antes do último registro enviado (ex.: as
 * organizações foram todas, mas uma pessoa de antes delas ficou de fora); o que se repetir na próxima rodada só é
 * atualizado de novo, no mesmo id. Sem nenhum registro assim, o cursor fica onde estava. Quem chama ainda tira a
 * sobreposição (`withOverlap`).
 */
function safeCursor(done: Pending[], left: Pending[], from: string): string {
  const floor = Math.min(...left.map((p) => micros(p.at)));
  if (Number.isNaN(floor)) return from;
  let best: { at: string; key: number } | null = null;
  for (const p of done) {
    const key = micros(p.at);
    if (key < floor && (!best || key > best.key)) best = { at: p.at, key };
  }
  return best?.at ?? from;
}

/** `ts` menos a sobreposição, sem ficar antes de `from` (o cursor não volta). */
function withOverlap(ts: string, from: string): string {
  const back = Date.parse(ts) - CURSOR_OVERLAP_MS;
  if (Number.isNaN(back)) return from;
  const iso = new Date(back).toISOString();
  return micros(iso) > micros(from) ? iso : from;
}

/** Registros a que a linha aponta (entidade e id no CRM). */
function refsOf(entity: PushEntity, row: Row): [PushEntity, string][] {
  const out: [PushEntity, string][] = [];
  for (const [column, target] of PUSH_REFS[entity]) {
    const id = row[column];
    if (typeof id === "string" && id) out.push([target, id]);
  }
  if (entity === "notes" && isPushEntity(row.entity) && typeof row.record_id === "string" && row.record_id) {
    out.push([row.entity, row.record_id]);
  }
  return out;
}

const emptyCounters = (): Record<PushEntity, PushCounters> =>
  Object.fromEntries(PUSH_ORDER.map((e) => [e, { created: 0, updated: 0, deleted: 0, errors: 0 }])) as Record<
    PushEntity,
    PushCounters
  >;

export async function runPipedrivePush(deps: PushDeps, opts: { budgetMs: number }): Promise<PushReport> {
  const { client, store } = deps;
  const log = deps.log ?? (() => {});
  const report: PushReport = { status: "done", counters: emptyCounters(), errors: [] };
  const skip = (reason: string): PushReport => {
    log(`Atualização do Pipedrive não rodou: ${reason}`);
    return { ...report, status: "skipped", reason };
  };

  let runId: string | null = null;
  let cursorFrom = "";
  let savedCursor: string | null = null;
  try {
    const settings = await store.settings();
    if (!settings.enabled) return skip("rotina desligada");
    const startedAt = deps.now();
    if (await store.mirrorActive(startedAt)) {
      return skip("modo espelho ativo (a última importação do Pipedrive rodou como espelho há menos de 48 h)");
    }
    if (!settings.cursor) return skip("rotina ligada sem cursor: desligue e ligue de novo para começar de agora");
    cursorFrom = settings.cursor;
    const deadline = startedAt.getTime() + opts.budgetMs;

    runId = await store.startRun(cursorFrom);
    const ctx = await store.buildContext();

    const key = (entity: PushEntity, id: string) => `${entity}:${id}`;
    const companyOf = (row: Row, fallback: string) =>
      typeof row.company_id === "string" && row.company_id ? row.company_id : fallback;
    /** Falhas anteriores de cada registro da fila de retry. */
    const attempts = new Map<string, number>();
    /** Registros já tratados nesta rodada (um registro da fila que também mudou vai uma vez só). */
    const handled = new Set<string>();
    let timedOut = false;
    const outOfTime = () => (timedOut ||= deps.now().getTime() >= deadline);

    function addError(entity: PushEntity, id: string, reason: string): void {
      report.counters[entity].errors++;
      if (report.errors.length < MAX_REPORT_ERRORS) report.errors.push({ entity, id, reason });
    }

    /**
     * Envia a linha: POST e vínculo sem id no Pipedrive; PUT (lead: PATCH) com id. Relacionado sem id no Pipedrive:
     * cria os que faltam sob demanda (`level` é a distância até o registro que a rodada está enviando) e converte de
     * novo, uma vez.
     */
    async function send(entity: PushEntity, row: Row, companyId: string, level = 0): Promise<Outcome> {
      let payload = CONVERT[entity](row, ctx);
      let problems: string[] = [];
      if ("error" in payload && WAITING_DEPENDENCY.test(payload.error) && level < MAX_DEPENDENCY_DEPTH) {
        problems = await createDependencies(entity, row, level + 1);
        payload = CONVERT[entity](row, ctx);
      }
      if ("error" in payload) {
        const reason = problems.length ? `${payload.error} (${problems.join("; ")})` : payload.error;
        return { failed: reason, waiting: WAITING_DEPENDENCY.test(payload.error) };
      }
      const id = String(row.id);
      const pdId = await store.pdIdOf(entity, id);
      if (pdId) {
        try {
          const path = `${payload.path}/${pdId}`;
          await (entity === "leads" ? client.patch(path, payload.body) : client.put(path, payload.body));
          return { done: "updated" };
        } catch (e) {
          if (e instanceof PipedriveAuthError) throw e;
          if (!(e instanceof PipedriveError && e.status !== undefined && GONE.has(e.status))) {
            throw new RecordFailure(messageOf(e));
          }
          log(`${entity} ${id}: o id ${pdId} não existe mais no Pipedrive; criando de novo`);
        }
      }
      const { path, body } = payload;
      const newId = createdId(await pd(() => client.post(path, body)));
      if (!newId) return { failed: "o Pipedrive não devolveu o id do registro criado" };
      // `link` não apaga o vínculo antigo: só o novo pode ficar
      if (pdId) await store.unlink(entity, id);
      await store.link(entity, newId, companyId, id);
      return { done: "created" };
    }

    /**
     * Cria no Pipedrive os relacionados da linha que ainda não têm id lá. Relacionado já tratado nesta rodada
     * (inclusive o que falhou) não é tentado de novo. Devolve o motivo de cada um que não deu.
     */
    async function createDependencies(entity: PushEntity, row: Row, level: number): Promise<string[]> {
      const problems: string[] = [];
      for (const [target, refId] of refsOf(entity, row)) {
        // carrega o vínculo, se houver (o contexto só conhece os já carregados)
        if (await store.pdIdOf(target, refId)) continue;
        const k = key(target, refId);
        if (handled.has(k)) {
          problems.push(`${target} ${refId} falhou nesta rodada`);
          continue;
        }
        handled.add(k);
        const problem = await createDependency(target, refId, level);
        if (problem) problems.push(`${target} ${refId}: ${problem}`);
      }
      return problems;
    }

    /**
     * Cria um relacionado sob demanda, com a mesma contagem e fila de um registro da rodada: se falhar, entra na fila
     * de retry com o próprio erro e vai antes do dependente nas próximas rodadas. Devolve o motivo se não deu.
     */
    async function createDependency(entity: PushEntity, id: string, level: number): Promise<string | null> {
      const row = await store.loadOne(entity, id);
      if (!row) return "na lixeira ou apagado no CRM";
      const companyId = companyOf(row, "");
      const outcome = await settle(entity, id, companyId, () => send(entity, row, companyId, level));
      if ("failed" in outcome) return outcome.failed;
      log(`${entity} ${id}: criado no Pipedrive sob demanda, para um registro que aponta para ele`);
      return null;
    }

    /** Apaga no Pipedrive o registro que foi para a lixeira, se ele tem vínculo. */
    async function remove(entity: PushEntity, id: string): Promise<Outcome> {
      const pdId = await store.pdIdOf(entity, id);
      if (!pdId) return { done: null };
      await pd(() => client.del(`${PATHS[entity]}/${pdId}`));
      await store.unlink(entity, id);
      return { done: "deleted" };
    }

    /** Conta o resultado e cuida da fila: sai dela no sucesso; na falha, entra (ou sai de vez na última tentativa). */
    async function settle(
      entity: PushEntity,
      id: string,
      companyId: string,
      work: () => Promise<Outcome>,
    ): Promise<Outcome> {
      const k = key(entity, id);
      handled.add(k);
      const before = attempts.get(k) ?? 0;
      let outcome: Outcome;
      try {
        outcome = await work();
      } catch (e) {
        if (!(e instanceof RecordFailure)) throw e;
        outcome = { failed: e.message };
      }
      if ("done" in outcome) {
        if (outcome.done) report.counters[entity][outcome.done]++;
        if (before > 0) await store.clearRetry(entity, id);
        attempts.delete(k);
        return outcome;
      }
      if (before + 1 >= MAX_ATTEMPTS) {
        if (before > 0) await store.clearRetry(entity, id);
        attempts.delete(k);
        addError(entity, id, `${outcome.failed} (desistiu depois de ${MAX_ATTEMPTS} tentativas)`);
        return outcome;
      }
      await store.queueRetry(entity, id, companyId, outcome.failed);
      attempts.set(k, before + 1);
      if (outcome.waiting) log(`${entity} ${id}: ${outcome.failed}; fica na fila para depois do relacionado`);
      else addError(entity, id, outcome.failed);
      return outcome;
    }

    // 1. fila de retry
    const queue = await store.retryQueue();
    for (const item of queue) attempts.set(key(item.entity, item.record_id), item.attempts);
    for (const item of queue) {
      if (outOfTime()) break;
      const row = await store.loadOne(item.entity, item.record_id);
      await settle(item.entity, item.record_id, item.company_id, () =>
        row ? send(item.entity, row, companyOf(row, item.company_id)) : remove(item.entity, item.record_id),
      );
    }

    // 2. exclusões, na ordem inversa
    for (const entity of [...PUSH_ORDER].reverse()) {
      if (timedOut) break;
      for (const gone of await store.deleted(entity, cursorFrom)) {
        if (handled.has(key(entity, gone.id))) continue;
        if (outOfTime()) break;
        await settle(entity, gone.id, gone.company_id, () => remove(entity, gone.id));
      }
    }

    // 3. mudanças: todas as entidades lidas antes de começar, para o cursor de uma rodada que pare no meio
    let cursorTo = cursorFrom;
    if (!timedOut) {
      const pending: Pending[] = [];
      /** Linhas que perdem para outra do mesmo registro do Pipedrive mudada depois (importado em duas empresas). */
      const older = new Set<Row>();
      for (const entity of PUSH_ORDER) {
        const newest = new Map<string, { row: Row; key: number }>();
        for (const row of await readChanged(store, entity, cursorFrom)) {
          const at = String(row.updated_at);
          pending.push({ entity, row, at });
          const pdId = await store.pdIdOf(entity, String(row.id));
          if (!pdId) continue;
          const mine = { row, key: micros(at) };
          const other = newest.get(pdId);
          if (!other) newest.set(pdId, mine);
          else if (mine.key >= other.key) {
            older.add(other.row);
            newest.set(pdId, mine);
          } else older.add(row);
        }
      }

      let i = 0;
      for (; i < pending.length; i++) {
        const { entity, row } = pending[i];
        const id = String(row.id);
        if (handled.has(key(entity, id))) continue;
        if (older.has(row)) {
          log(`${entity} ${id}: o mesmo registro do Pipedrive mudou depois em outra empresa; vai só a versão mais nova`);
          continue;
        }
        if (outOfTime()) break;
        await settle(entity, id, companyOf(row, ""), () => send(entity, row, companyOf(row, "")));
      }
      cursorTo = timedOut
        ? withOverlap(safeCursor(pending.slice(0, i), pending.slice(i), cursorFrom), cursorFrom)
        : withOverlap(startedAt.toISOString(), cursorFrom);
    }

    if (timedOut) report.reason = "tempo esgotado: o que faltou fica para a próxima rodada";
    await store.saveCursor(cursorTo);
    savedCursor = cursorTo;
    await store.finishRun(runId, { status: "done", cursorTo, counters: report.counters, errors: report.errors });
    log(summary(report, cursorTo));
    return report;
  } catch (e) {
    report.status = "failed";
    report.reason = messageOf(e);
    log(`Atualização do Pipedrive falhou: ${report.reason}`);
    if (runId) {
      try {
        await store.finishRun(runId, {
          status: "failed",
          cursorTo: savedCursor ?? cursorFrom,
          counters: report.counters,
          errors: report.errors,
        });
      } catch (e2) {
        log(`Não deu para fechar a rodada: ${messageOf(e2)}`);
      }
    }
    return report;
  }
}

/** Todas as páginas de `changed`, na ordem `(updated_at, id)`. */
async function readChanged(store: PushStore, entity: PushEntity, since: string): Promise<Row[]> {
  const rows: Row[] = [];
  let page = await store.changed(entity, since, PAGE);
  for (;;) {
    rows.push(...page);
    if (page.length < PAGE) return rows;
    const last = page[page.length - 1];
    page = await store.changed(entity, String(last.updated_at), PAGE, String(last.id));
  }
}

function summary(report: PushReport, cursorTo: string): string {
  const parts = PUSH_ORDER.flatMap((e) => {
    const c = report.counters[e];
    if (!c.created && !c.updated && !c.deleted && !c.errors) return [];
    return [`${e}: ${c.created} criados, ${c.updated} atualizados, ${c.deleted} apagados, ${c.errors} erros`];
  });
  const what = parts.length ? parts.join("; ") : "nada para enviar";
  return `Atualização do Pipedrive concluída${report.reason ? ` (${report.reason})` : ""}: ${what}. Cursor: ${cursorTo}.`;
}
