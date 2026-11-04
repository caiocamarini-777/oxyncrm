import {
  GmailApiError,
  type GmailClient,
  GmailAuthError,
  GmailHistoryExpiredError,
  GmailNetworkError,
  GmailRateLimitError,
} from "./client";
import { type ContactIndex, type EmailLinkTarget, matchMessage } from "./matcher";
import { parseGmailMessage, type ParsedMessage } from "./parse";
import {
  backfillQuery,
  chunk,
  decodeCursor,
  dedupeRefs,
  encodeCursor,
  groupByThread,
  historyRefs,
  latestHistoryId,
  MAX_MESSAGE_ATTEMPTS,
  messageAddresses,
  needsFull,
  recoveryAfter,
  skipByLabels,
  type SyncAccount,
} from "./sync-core";
import type { AccountPatch, SyncStore } from "./store";

/** Máximo de mensagens processadas ao mesmo tempo por caixa. */
export const CONCURRENCY = 8;
const PAGE_SIZE = 100;

export type SyncClient = Pick<GmailClient, "getProfile" | "listMessages" | "getMessage" | "getThread" | "listHistory">;

export type SyncDeps = {
  client: SyncClient;
  store: SyncStore;
  /** Carrega o índice de contatos da empresa; só é chamado se houver mensagem a casar (uma vez por execução). */
  loadIndex: () => Promise<ContactIndex>;
  /** Instante (ms desde 1970) em que a execução deve parar de começar trabalho novo. */
  deadline: number;
  now?: () => number;
};

export type SyncResult = {
  processed: number;
  stored: number;
  linked: number;
  errors: number;
  /** Mensagens ignoradas por erro permanente (veja `isPoison`) ou por 5xx repetido; não impedem o avanço do cursor. */
  skipped: number;
  /** `recovery`: o histórico expirou e a caixa foi relida dos últimos 7 dias. */
  phase: "backfill" | "incremental" | "recovery";
  /** Falso quando parou no orçamento de tempo ou num erro transitório/de banco; a próxima execução continua. */
  complete: boolean;
  /** Primeiro erro (ou mensagem ignorada), para `last_error`. */
  lastError: string | null;
};

type Ref = { id: string; threadId: string };

const isFatal = (e: unknown) => e instanceof GmailAuthError || e instanceof GmailRateLimitError;

/** Falha ao gravar no banco: infraestrutura, nunca vira "mensagem ignorada". */
class StoreError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "erro ao gravar");
    this.name = "StoreError";
  }
}

/** 5xx/408 do Gmail: o erro pode ser da mensagem; conta por id e, depois de 3, ela é pulada. */
const isServerError = (e: unknown) => e instanceof GmailApiError && (e.status >= 500 || e.status === 408);

/** Rede (`GmailNetworkError`), timeout e 5xx/408: voltam a ser tentados na próxima execução. */
const isTransient = (e: unknown) =>
  e instanceof GmailNetworkError ||
  (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) ||
  isServerError(e);

/**
 * Mensagem envenenada: o erro é só dela (4xx do Gmail, corpo que não dá para ler, bug de leitura) e repetir
 * não adianta. Em vez de travar a caixa para sempre, o erro vai para `last_error` com o id e o lote avança
 * sem ela. Autenticação, limite de uso, rede/timeout e falhas de banco continuam impedindo o avanço; 5xx
 * impede até a 3ª tentativa da mesma mensagem (contadas em `sync_failures`).
 */
const isPoison = (e: unknown) => !isFatal(e) && !isTransient(e) && !(e instanceof StoreError);

const isNotFound = (e: unknown) => e instanceof GmailApiError && e.status === 404;

function unionLinks(all: EmailLinkTarget[][]): EmailLinkTarget[] {
  const seen = new Map<string, EmailLinkTarget>();
  for (const l of all.flat()) seen.set(`${l.entity}:${l.recordId}`, l);
  return [...seen.values()];
}

/**
 * Sincroniza uma caixa.
 * - Primeira carga (`backfill_done = false`): grava o `history_id` do perfil se for nulo, pagina `messages.list`
 *   (12 meses, ou 7 dias na recuperação) guardando o cursor a cada página, e marca `backfill_done` no fim.
 * - Incremental: `history.list` a partir do `history_id`, página a página; ao fim de cada página sem erros
 *   grava o maior `history[].id` dela (na última, o `historyId` da resposta). `GmailHistoryExpiredError`
 *   reinicia a carga com os últimos 7 dias.
 * - Erro 5xx numa mensagem conta em `sync_failures`; na 3ª ela é pulada e o cursor segue.
 * `GmailAuthError` e `GmailRateLimitError` sobem para quem chamou (o cron decide); erro de uma mensagem é contado (transitório/banco) ou ignorado (`isPoison`).
 */
export async function syncAccount(accountIn: SyncAccount, deps: SyncDeps): Promise<SyncResult> {
  const { client, store } = deps;
  const now = deps.now ?? Date.now;
  const account: SyncAccount = { ...accountIn };
  const result: SyncResult = { processed: 0, stored: 0, linked: 0, errors: 0, skipped: 0, phase: "incremental", complete: true, lastError: null };

  let indexPromise: Promise<ContactIndex> | null = null;
  const getIndex = () => (indexPromise ??= deps.loadIndex());
  const expired = () => now() >= deps.deadline;
  const stamp = () => new Date(now()).toISOString();

  // Mensagens já gravadas nesta execução (inclui as que vieram junto de uma conversa inteira).
  const handled = new Set<string>();

  // Tentativas com 5xx por mensagem, gravadas junto com o cursor ou no fim da execução.
  const failures: Record<string, number> = { ...(accountIn.sync_failures ?? {}) };
  let failuresDirty = false;
  const setFailures = (id: string, n: number | null) => {
    if (n === null) {
      if (!(id in failures)) return;
      delete failures[id];
    } else failures[id] = n;
    failuresDirty = true;
  };
  const failuresPatch = (): AccountPatch => {
    if (!failuresDirty) return {};
    failuresDirty = false;
    return { sync_failures: { ...failures } };
  };

  /**
   * O cursor avançou depois destas mensagens: o contador delas não serve mais (gravadas ou puladas) e sai
   * do mapa. Grava o patch do cursor com o mapa, se mudou.
   */
  async function advance(refs: Ref[], patch: AccountPatch) {
    for (const r of refs) setFailures(r.id, null);
    const full = { ...patch, ...failuresPatch() };
    if (Object.keys(full).length > 0) await store.updateAccount(account.id, full);
  }

  function skip(ref: Ref, why: string) {
    result.skipped++;
    result.lastError ??= `${ref.id} ignorada: ${why}`.slice(0, 500);
    console.error("gmail: mensagem ignorada", account.id, ref.id, why);
  }

  async function save(parsed: ParsedMessage, links: EmailLinkTarget[]) {
    try {
      const r = await store.storeMessage(account, parsed, links);
      handled.add(parsed.gmailId);
      result.stored++;
      result.linked += r.linksInserted;
    } catch (e) {
      throw new StoreError(e);
    }
  }

  /**
   * Conversa que passa a casar agora (não estava salva): busca a conversa inteira e grava todas as mensagens
   * dela, menos rascunho/spam/lixo. Os vínculos são a união dos de todas as mensagens, gravados uma vez.
   */
  async function storeWholeThread(ref: Ref, index: ContactIndex) {
    let thread;
    try {
      thread = await client.getThread(ref.threadId, "full");
    } catch (e) {
      if (isNotFound(e)) return; // apagada entre a listagem e a leitura
      throw e;
    }
    const parsed = (thread.messages ?? []).filter((m) => !skipByLabels(m.labelIds)).map(parseGmailMessage);
    const links = unionLinks(parsed.map((p) => matchMessage(messageAddresses(p), account.email, index)));
    for (const [i, p] of parsed.entries()) await save(p, i === 0 ? links : []);
  }

  async function processOne(ref: Ref, index: ContactIndex, storedThreads: Set<string>) {
    if (handled.has(ref.id)) return;
    let meta;
    try {
      meta = await client.getMessage(ref.id, "metadata");
    } catch (e) {
      if (isNotFound(e)) return; // apagada entre a listagem e a leitura
      throw e;
    }
    if (skipByLabels(meta.labelIds)) return;
    const links = matchMessage(messageAddresses(parseGmailMessage(meta)), account.email, index);
    const threadStored = storedThreads.has(ref.threadId);
    if (!needsFull(links, threadStored)) return;
    if (!threadStored) {
      await storeWholeThread(ref, index);
    } else {
      await save(parseGmailMessage(await client.getMessage(ref.id, "full")), links);
    }
    storedThreads.add(ref.threadId);
  }

  /** Processa as mensagens em blocos de CONCURRENCY. Falso se parou no orçamento de tempo. */
  async function processRefs(refs: Ref[]): Promise<boolean> {
    for (const block of chunk(dedupeRefs(refs), CONCURRENCY)) {
      if (expired()) return false;
      result.processed += block.length;
      const known = await store.storedMessageIds(account.id, block.map((r) => r.id));
      const todo = block.filter((r) => !known.has(r.id));
      if (todo.length === 0) continue;
      const storedThreads = await store.storedThreadIds(account.id, [...new Set(todo.map((r) => r.threadId))]);
      const index = await getIndex();

      // Mensagens da mesma conversa em sequência; conversas diferentes em paralelo.
      const settled = await Promise.allSettled(
        groupByThread(todo).map(async (group) => {
          for (const ref of group) {
            const tries = failures[ref.id] ?? 0;
            if (tries >= MAX_MESSAGE_ATTEMPTS) {
              skip(ref, `falhou ${tries} vezes no Gmail`);
              continue;
            }
            try {
              await processOne(ref, index, storedThreads);
              setFailures(ref.id, null);
            } catch (e) {
              if (isFatal(e)) throw e;
              const why = e instanceof Error ? e.message : "erro";
              if (isPoison(e)) {
                skip(ref, why);
              } else if (isServerError(e) && tries + 1 >= MAX_MESSAGE_ATTEMPTS) {
                setFailures(ref.id, tries + 1);
                skip(ref, `${why} (${tries + 1} tentativas)`);
              } else {
                if (isServerError(e)) setFailures(ref.id, tries + 1);
                result.errors++;
                result.lastError ??= `${ref.id}: ${why}`.slice(0, 500);
                console.error("gmail: falha ao processar mensagem", account.id, ref.id, why);
              }
            }
          }
        }),
      );
      const fatal = settled.find((s) => s.status === "rejected");
      if (fatal) throw (fatal as PromiseRejectedResult).reason;
    }
    return true;
  }

  async function baseline() {
    if (account.history_id) return;
    const profile = await client.getProfile();
    account.history_id = profile.historyId;
    await store.updateAccount(account.id, { history_id: profile.historyId });
  }

  async function backfill(): Promise<void> {
    await baseline();
    const cursor = decodeCursor(account.backfill_page_token, new Date(now()));
    for (;;) {
      if (expired()) {
        result.complete = false;
        return;
      }
      const page = await client.listMessages({
        q: backfillQuery(cursor.after),
        pageToken: cursor.pageToken ?? undefined,
        maxResults: PAGE_SIZE,
      });
      const errorsBefore = result.errors;
      const done = await processRefs(page.messages);
      // Página incompleta ou com erro: o cursor não avança e a próxima execução refaz a página (o que já
      // foi gravado é pulado).
      if (!done || result.errors > errorsBefore) {
        result.complete = false;
        return;
      }
      if (!page.nextPageToken) {
        account.backfill_done = true;
        account.backfill_page_token = null;
        await advance(page.messages, { backfill_done: true, backfill_page_token: null, last_synced_at: stamp() });
        return;
      }
      cursor.pageToken = page.nextPageToken;
      account.backfill_page_token = encodeCursor(cursor.after, cursor.pageToken);
      await advance(page.messages, { backfill_page_token: account.backfill_page_token, last_synced_at: stamp() });
    }
  }

  /**
   * Página a página: cada página do `history.list` é processada e, sem erros, o `history_id` avança até o
   * maior registro dela (na última página, até o `historyId` atual da caixa). Com erro ou sem tempo, para
   * ali: a próxima execução recomeça da última página concluída, não do lote inteiro.
   */
  async function incremental(): Promise<void> {
    const start = account.history_id!;
    const seen = new Set<string>(); // o histórico repete a mesma mensagem entre páginas
    let pageToken: string | undefined;
    do {
      if (expired()) {
        result.complete = false;
        return;
      }
      const r = await client.listHistory({ startHistoryId: start, pageToken });
      const refs = historyRefs(r.history).filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
      const errorsBefore = result.errors;
      const done = await processRefs(refs);
      if (!done || result.errors > errorsBefore) {
        result.complete = false; // history_id fica na última página concluída
        return;
      }
      pageToken = r.nextPageToken;
      const latest = pageToken ? latestHistoryId(r.history) : r.historyId;
      const patch: AccountPatch = {};
      if (latest && latest !== account.history_id) {
        account.history_id = latest;
        patch.history_id = latest;
      }
      await advance(refs, patch);
    } while (pageToken);
  }

  /** Histórico expirado: novo ponto de partida e releitura dos últimos 7 dias. */
  async function recover(): Promise<void> {
    const profile = await client.getProfile();
    account.history_id = profile.historyId;
    account.backfill_done = false;
    account.backfill_page_token = encodeCursor(recoveryAfter(new Date(now())), null);
    result.phase = "recovery";
    await store.updateAccount(account.id, {
      history_id: account.history_id,
      backfill_done: false,
      backfill_page_token: account.backfill_page_token,
    });
    await backfill();
  }

  if (!account.backfill_done) {
    result.phase = "backfill";
    await backfill();
  } else if (!account.history_id) {
    await baseline(); // caixa pronta sem ponto de partida (não deveria ocorrer): começa daqui
  } else {
    try {
      await incremental();
    } catch (e) {
      if (!(e instanceof GmailHistoryExpiredError)) throw e;
      await recover();
    }
  }

  await store.updateAccount(account.id, { last_synced_at: stamp(), last_error: result.lastError, ...failuresPatch() });
  return result;
}
