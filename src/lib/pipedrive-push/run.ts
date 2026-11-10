/**
 * Rodada da atualização do Pipedrive pelo CRM (piloto pós-virada). Copia para o Pipedrive o que foi criado, mudado
 * ou apagado no CRM desde o cursor de cada entidade.
 *
 * Não roda (`skipped`: nada é lido nem enviado) com a rotina desligada, com o modo espelho ativo ou com outra rodada
 * em andamento. Quando roda:
 *
 * 1. **Fila de retry**, na ordem das dependências (organizações → anotações). O registro fora da lixeira é enviado de
 *    novo; o que foi para a lixeira (ou não existe mais) é apagado no Pipedrive, se tinha vínculo.
 * 2. **Exclusões** desde o cursor de cada entidade, na ordem inversa (anotações → organizações): `del` e `unlink`.
 * 3. **Mudanças** desde o cursor de cada entidade, na ordem organizações → anotações. Sem id no Pipedrive: POST e
 *    vínculo. Com id: PUT (lead: PATCH). Id que não existe mais lá (404/410 na atualização) é criado de novo e
 *    religado. Organização, pessoa, lead ou negócio criado no Pipedrive põe na fila as atividades e anotações dele que
 *    já tinham id lá (apontam para a cópia antiga).
 *
 * **Relacionado sem id no Pipedrive.** O que está na lixeira (ou apagado) no CRM vira vínculo vazio, e o registro vai
 * mesmo assim: quando o relacionado foi apagado no Pipedrive, o Pipedrive já desfez o vínculo. O relacionado vivo no
 * CRM é criado sob demanda (ex.: a pessoa do negócio criada no CRM antes do cursor e que não mudou depois), até dois
 * níveis (negócio → pessoa → organização), e o registro é tentado mais uma vez.
 *
 * As exclusões vêm antes das mudanças porque `deleted` não devolve o `deleted_at`: as exclusões de todas as entidades
 * terminam antes de qualquer cursor andar. Os dois conjuntos não se cruzam (mudança é só fora da lixeira).
 *
 * **Falhas.**
 * - Falha de um registro (resposta de validação do Pipedrive, conversão, etapa sem correspondente) não para a rodada:
 *   ele vai para a fila de retry e, na quinta falha, sai da fila e fica só no relatório. O relacionado criado sob
 *   demanda que falha também entra na fila, com o próprio erro. Registro que continua esperando um relacionado vivo
 *   vai para a fila sem contar como erro: a fila anda na ordem das dependências, então ele é tentado depois.
 * - Falha geral do Pipedrive (`isSystemic`: rede, timeout, 5xx, 429 depois das esperas, 402, 403, 409) para a rodada
 *   na hora (`failed`): o registro não conta tentativa nem entra na fila, e o cursor da entidade dele não anda. Token
 *   inválido (`PipedriveAuthError`) e falha do banco também param a rodada.
 *
 * **Cursores.** Cada entidade tem o seu e lê as mudanças a partir dele; ele é gravado quando as mudanças da entidade
 * terminam, ou quando o tempo acaba no meio delas (ver `entityCursor`). Uma entidade com muito a enviar não segura as
 * outras: a rodada seguinte continua dela de onde parou, e as seguintes andam assim que ela acaba.
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
import { isPushEntity, PUSH_ORDER, PUSH_REFS, RUN_LOCK_MS, type PushCursor, type PushStore } from "./store";

export type PushCounters = { created: number; updated: number; deleted: number; errors: number };

export type PushReport = {
  status: "done" | "failed" | "skipped";
  /** Por que não rodou, por que falhou ou por que parou antes do fim (tempo esgotado). */
  reason?: string;
  counters: Record<PushEntity, PushCounters>;
  errors: { entity: string; id: string; reason: string }[];
  /** Avisos da rodada, sem repetir (ex.: etapa do CRM com mais de uma etapa do Pipedrive). */
  warnings: string[];
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
/** Mensagem de `pdRef` (mapping.ts) quando o registro relacionado, vivo no CRM, ainda não foi criado no Pipedrive. */
const WAITING_DEPENDENCY = /ainda sem id no Pipedrive/;
/** Níveis de relacionados criados sob demanda a partir do registro enviado (negócio → pessoa → organização). */
export const MAX_DEPENDENCY_DEPTH = 2;
/**
 * A próxima rodada relê o que mudou nos últimos 2 minutos antes do início desta: cobre a diferença entre o relógio da
 * rodada e o do banco e a transação que gravou `updated_at` antes do início da rodada mas só terminou depois da
 * leitura. Reenviar um registro já vinculado é só um PUT de novo.
 */
export const CURSOR_OVERLAP_MS = 2 * 60_000;
/** Registros que têm atividades e anotações no Pipedrive (as que vão de novo quando ele é criado de novo lá). */
const PARENTS = new Set<PushEntity>(["organizations", "persons", "leads", "deals"]);

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

/** Falha geral do Pipedrive: para a rodada, sem mexer no cursor da entidade nem na fila. */
class PipedriveUnavailable extends Error {}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Respostas que não dizem respeito ao registro: rede ou timeout (sem status), 5xx, 429 que as esperas do cliente não
 * resolveram, 402 (conta do Pipedrive sem pagamento), 403 (cota ou permissão do usuário do token) e 409 (conflito).
 * Tentar de novo na próxima rodada resolve, então o registro não gasta tentativa. As outras 4xx são do registro
 * (validação); o 404 e o 410 da atualização e da exclusão já são tratados antes (registro apagado no Pipedrive).
 */
function isSystemic(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 402 || status === 403 || status === 409 || status === 429;
}

/** Erro de uma chamada ao Pipedrive para um registro: token inválido e falha geral param a rodada; o resto é do registro. */
function failure(e: unknown, entity: PushEntity, id: string): never {
  if (e instanceof PipedriveAuthError) throw e;
  if (e instanceof PipedriveError && isSystemic(e.status)) {
    throw new PipedriveUnavailable(`Pipedrive indisponível (${entity} ${id}): ${e.message}`);
  }
  throw new RecordFailure(messageOf(e));
}

/** Chamada ao Pipedrive para um registro, com os erros de `failure`. */
async function pd<T>(call: () => Promise<T>, entity: PushEntity, id: string): Promise<T> {
  try {
    return await call();
  } catch (e) {
    failure(e, entity, id);
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

/**
 * Ordem dos cursores: pelo `updated_at` e, no mesmo instante, pelo `id`. Sem `id` vem depois de todos os ids daquele
 * instante (tudo o que tem esse `updated_at` já foi).
 */
function compareCursors(a: PushCursor, b: PushCursor): number {
  const ta = micros(a.at);
  const tb = micros(b.at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.id === b.id) return 0;
  if (a.id === undefined) return 1;
  if (b.id === undefined) return -1;
  return a.id < b.id ? -1 : 1;
}

/**
 * Cursor de uma entidade ao fim das mudanças dela. `last` é o último registro tratado na ordem `(updated_at, id)`
 * (enviado, ou pulado porque já foi nesta rodada); `complete`, se não ficou nenhum de fora.
 * - Completa: o início da rodada menos a sobreposição (`CURSOR_OVERLAP_MS`).
 * - Tempo esgotado no meio: o `(updated_at, id)` do último tratado, e a próxima rodada continua do registro seguinte,
 *   mesmo numa mudança em massa com o mesmo `updated_at`. Se ele já passou do início da rodada menos a sobreposição,
 *   o cursor fica nesse ponto (tudo antes dele foi tratado), para a sobreposição continuar valendo.
 * O cursor nunca volta.
 */
function entityCursor(from: PushCursor, startedAt: Date, last: { at: string; id: string } | null, complete: boolean): PushCursor {
  const cap: PushCursor = { at: new Date(startedAt.getTime() - CURSOR_OVERLAP_MS).toISOString() };
  let next: PushCursor;
  if (complete) next = cap;
  else if (!last) next = from;
  else next = micros(last.at) <= micros(cap.at) ? { at: last.at, id: last.id } : cap;
  return compareCursors(next, from) > 0 ? next : from;
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
  const report: PushReport = { status: "done", counters: emptyCounters(), errors: [], warnings: [] };
  const skip = (reason: string): PushReport => {
    log(`Atualização do Pipedrive não rodou: ${reason}`);
    return { ...report, status: "skipped", reason };
  };

  let runId: string | null = null;
  /** Cursor de cada entidade: o gravado, ou o inicial comum; anda à medida que as mudanças de cada uma terminam. */
  const cursors = {} as Record<PushEntity, PushCursor>;
  /** O mais antigo dos cursores (o `cursor_from`/`cursor_to` do relatório: tudo antes dele já foi enviado). */
  const oldest = () =>
    PUSH_ORDER.map((e) => cursors[e]).reduce((a, b) => (compareCursors(a, b) <= 0 ? a : b)).at;

  function addWarning(message: string): void {
    if (report.warnings.includes(message)) return;
    report.warnings.push(message);
    log(`Aviso: ${message}`);
  }

  try {
    const settings = await store.settings();
    if (!settings.enabled) return skip("rotina desligada");
    const startedAt = deps.now();
    if (await store.mirrorActive(startedAt)) {
      return skip("modo espelho ativo (a última importação do Pipedrive rodou como espelho há menos de 48 h)");
    }
    if (!settings.cursor) return skip("rotina ligada sem cursor: desligue e ligue de novo para começar de agora");
    if (await store.runActive(startedAt)) {
      return skip(`outra rodada em andamento (iniciada há menos de ${RUN_LOCK_MS / 60_000} min)`);
    }
    for (const entity of PUSH_ORDER) cursors[entity] = settings.cursors[entity] ?? { at: settings.cursor };
    const deadline = startedAt.getTime() + opts.budgetMs;

    runId = await store.startRun(oldest());
    const ctx = await store.buildContext(addWarning);

    const key = (entity: PushEntity, id: string) => `${entity}:${id}`;
    const companyOf = (row: Row, fallback: string) =>
      typeof row.company_id === "string" && row.company_id ? row.company_id : fallback;
    /** Falhas anteriores de cada registro da fila de retry. */
    const attempts = new Map<string, number>();
    /** Registros que estão na fila de retry: os do início da rodada e os postos nela durante a rodada. */
    const queued = new Set<string>();
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
     * resolve os que faltam (`resolveDependencies`; `level` é a distância até o registro que a rodada está enviando) e
     * converte de novo, uma vez.
     */
    async function send(entity: PushEntity, row: Row, companyId: string, level = 0): Promise<Outcome> {
      let payload = CONVERT[entity](row, ctx);
      let problems: string[] = [];
      if ("error" in payload && WAITING_DEPENDENCY.test(payload.error)) {
        problems = await resolveDependencies(entity, row, level + 1);
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
          if (!(e instanceof PipedriveError && e.status !== undefined && GONE.has(e.status))) failure(e, entity, id);
          log(`${entity} ${id}: o id ${pdId} não existe mais no Pipedrive; criando de novo`);
        }
      }
      if (payload.createError) return { failed: payload.createError };
      const { path, body, createOnly } = payload;
      const newId = createdId(await pd(() => client.post(path, { ...body, ...createOnly }), entity, id));
      if (!newId) return { failed: "o Pipedrive não devolveu o id do registro criado" };
      // `link` não apaga o vínculo antigo: só o novo pode ficar
      if (pdId) await store.unlink(entity, id);
      await store.link(entity, newId, companyId, id);
      if (PARENTS.has(entity)) await requeueChildren(entity, id);
      return { done: "created" };
    }

    /**
     * Relacionados da linha sem id no Pipedrive. O que está na lixeira (ou apagado) no CRM fica anotado no contexto
     * por `loadOne` e vira vínculo vazio na conversão. O vivo é criado sob demanda até `MAX_DEPENDENCY_DEPTH` (`level`
     * é o nível dele), com a mesma contagem e fila de um registro da rodada; o já tratado nesta rodada (inclusive o
     * que falhou) não é tentado de novo. Devolve o motivo de cada um que não deu.
     */
    async function resolveDependencies(entity: PushEntity, row: Row, level: number): Promise<string[]> {
      const problems: string[] = [];
      for (const [target, refId] of refsOf(entity, row)) {
        // carrega o vínculo, se houver (o contexto só conhece os já carregados)
        if (await store.pdIdOf(target, refId)) continue;
        const dep = await store.loadOne(target, refId);
        if (!dep) continue;
        const k = key(target, refId);
        if (handled.has(k)) {
          problems.push(`${target} ${refId} falhou nesta rodada`);
          continue;
        }
        if (level > MAX_DEPENDENCY_DEPTH) continue;
        handled.add(k);
        const companyId = companyOf(dep, "");
        const outcome = await settle(target, refId, companyId, () => send(target, dep, companyId, level));
        if ("failed" in outcome) problems.push(`${target} ${refId}: ${outcome.failed}`);
        else log(`${target} ${refId}: criado no Pipedrive sob demanda, para um registro que aponta para ele`);
      }
      return problems;
    }

    /**
     * Registro criado (ou criado de novo) no Pipedrive: as atividades e anotações dele que já tinham id lá apontam
     * para a cópia antiga, que o Pipedrive apagou ou desvinculou. Vão para a fila, sem contar tentativa, e saem nesta
     * rodada (se também mudaram) ou na seguinte: o PUT as religa, ou dá 404 e elas são criadas de novo.
     */
    async function requeueChildren(entity: PushEntity, id: string): Promise<void> {
      let n = 0;
      for (const child of await store.linkedChildren(entity, id)) {
        const k = key(child.entity, child.id);
        if (queued.has(k)) continue;
        await store.requeue(child.entity, child.id, child.company_id, `${entity} ${id} criado de novo no Pipedrive`);
        queued.add(k);
        n++;
      }
      if (n) log(`${entity} ${id}: criado de novo no Pipedrive; ${n} atividade(s) e anotação(ões) dele vão de novo`);
    }

    /** Apaga no Pipedrive o registro que foi para a lixeira, se ele tem vínculo. */
    async function remove(entity: PushEntity, id: string): Promise<Outcome> {
      const pdId = await store.pdIdOf(entity, id);
      if (!pdId) return { done: null };
      await pd(() => client.del(`${PATHS[entity]}/${pdId}`), entity, id);
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
      const leaveQueue = async () => {
        if (queued.has(k)) await store.clearRetry(entity, id);
        queued.delete(k);
        attempts.delete(k);
      };
      if ("done" in outcome) {
        if (outcome.done) report.counters[entity][outcome.done]++;
        await leaveQueue();
        return outcome;
      }
      if (before + 1 >= MAX_ATTEMPTS) {
        await leaveQueue();
        addError(entity, id, `${outcome.failed} (desistiu depois de ${MAX_ATTEMPTS} tentativas)`);
        return outcome;
      }
      await store.queueRetry(entity, id, companyId, outcome.failed);
      queued.add(k);
      attempts.set(k, before + 1);
      if (outcome.waiting) log(`${entity} ${id}: ${outcome.failed}; fica na fila para depois do relacionado`);
      else addError(entity, id, outcome.failed);
      return outcome;
    }

    // 1. fila de retry
    const queue = await store.retryQueue();
    for (const item of queue) {
      attempts.set(key(item.entity, item.record_id), item.attempts);
      queued.add(key(item.entity, item.record_id));
    }
    for (const item of queue) {
      if (handled.has(key(item.entity, item.record_id))) continue;
      if (outOfTime()) break;
      const row = await store.loadOne(item.entity, item.record_id);
      await settle(item.entity, item.record_id, item.company_id, () =>
        row ? send(item.entity, row, companyOf(row, item.company_id)) : remove(item.entity, item.record_id),
      );
    }

    // 2. exclusões, na ordem inversa
    for (const entity of [...PUSH_ORDER].reverse()) {
      if (timedOut) break;
      for (const gone of await store.deleted(entity, cursors[entity].at)) {
        if (handled.has(key(entity, gone.id))) continue;
        if (outOfTime()) break;
        await settle(entity, gone.id, gone.company_id, () => remove(entity, gone.id));
      }
    }

    // 3. mudanças, entidade por entidade, cada uma desde o próprio cursor
    for (const entity of PUSH_ORDER) {
      if (timedOut) break;
      const from = cursors[entity];
      const rows = await readChanged(store, entity, from);
      const older = await olderVersions(store, entity, rows);
      let last: { at: string; id: string } | null = null;
      let complete = true;
      for (const row of rows) {
        const id = String(row.id);
        if (older.has(row)) {
          log(`${entity} ${id}: o mesmo registro do Pipedrive mudou depois em outra empresa; vai só a versão mais nova`);
        } else if (!handled.has(key(entity, id))) {
          if (outOfTime()) {
            complete = false;
            break;
          }
          await settle(entity, id, companyOf(row, ""), () => send(entity, row, companyOf(row, "")));
        }
        last = { at: String(row.updated_at), id };
      }
      const next = entityCursor(from, startedAt, last, complete);
      if (compareCursors(next, from) !== 0) {
        cursors[entity] = next;
        await store.saveCursors({ ...cursors });
      }
    }

    if (timedOut) report.reason = "tempo esgotado: o que faltou fica para a próxima rodada";
    const cursorTo = oldest();
    await store.finishRun(runId, {
      status: "done",
      cursorTo,
      counters: report.counters,
      errors: report.errors,
      warnings: report.warnings,
    });
    log(summary(report, cursors));
    return report;
  } catch (e) {
    report.status = "failed";
    report.reason = messageOf(e);
    log(`Atualização do Pipedrive falhou: ${report.reason}`);
    if (runId) {
      try {
        await store.finishRun(runId, {
          status: "failed",
          cursorTo: oldest(),
          counters: report.counters,
          errors: report.errors,
          warnings: report.warnings,
        });
      } catch (e2) {
        log(`Não deu para fechar a rodada: ${messageOf(e2)}`);
      }
    }
    return report;
  }
}

/** Todas as páginas de `changed` desde o cursor, na ordem `(updated_at, id)`. */
async function readChanged(store: PushStore, entity: PushEntity, from: PushCursor): Promise<Row[]> {
  const rows: Row[] = [];
  let page = await store.changed(entity, from.at, PAGE, from.id);
  for (;;) {
    rows.push(...page);
    if (page.length < PAGE) return rows;
    const last = page[page.length - 1];
    page = await store.changed(entity, String(last.updated_at), PAGE, String(last.id));
  }
}

/**
 * Linhas que perdem para outra do mesmo registro do Pipedrive mudada depois (importado em duas empresas do CRM): vai
 * só a versão com o `updated_at` mais novo.
 */
async function olderVersions(store: PushStore, entity: PushEntity, rows: Row[]): Promise<Set<Row>> {
  const older = new Set<Row>();
  const newest = new Map<string, { row: Row; key: number }>();
  for (const row of rows) {
    const pdId = await store.pdIdOf(entity, String(row.id));
    if (!pdId) continue;
    const mine = { row, key: micros(String(row.updated_at)) };
    const other = newest.get(pdId);
    if (!other) newest.set(pdId, mine);
    else if (mine.key >= other.key) {
      older.add(other.row);
      newest.set(pdId, mine);
    } else older.add(row);
  }
  return older;
}

function summary(report: PushReport, cursors: Record<PushEntity, PushCursor>): string {
  const parts = PUSH_ORDER.flatMap((e) => {
    const c = report.counters[e];
    if (!c.created && !c.updated && !c.deleted && !c.errors) return [];
    return [`${e}: ${c.created} criados, ${c.updated} atualizados, ${c.deleted} apagados, ${c.errors} erros`];
  });
  const what = parts.length ? parts.join("; ") : "nada para enviar";
  const where = PUSH_ORDER.map((e) => `${e} ${cursors[e].at}${cursors[e].id ? ` (${cursors[e].id})` : ""}`).join(", ");
  return `Atualização do Pipedrive concluída${report.reason ? ` (${report.reason})` : ""}: ${what}. Cursores: ${where}.`;
}
