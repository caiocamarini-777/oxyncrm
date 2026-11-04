import { GmailApiError, type GmailClient, GmailAuthError, GmailHistoryExpiredError, GmailRateLimitError } from "./client";
import { type ContactIndex, matchMessage } from "./matcher";
import { parseGmailMessage } from "./parse";
import {
  backfillQuery,
  chunk,
  decodeCursor,
  dedupeRefs,
  encodeCursor,
  groupByThread,
  messageAddresses,
  needsFull,
  recoveryAfter,
  skipByLabels,
  type SyncAccount,
} from "./sync-core";
import type { SyncStore } from "./store";

/** Máximo de mensagens processadas ao mesmo tempo por caixa. */
export const CONCURRENCY = 8;
const PAGE_SIZE = 100;

export type SyncClient = Pick<GmailClient, "getProfile" | "listMessages" | "getMessage" | "listHistory">;

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
  /** `recovery`: o histórico expirou e a caixa foi relida dos últimos 7 dias. */
  phase: "backfill" | "incremental" | "recovery";
  /** Falso quando parou no orçamento de tempo ou numa mensagem com erro; a próxima execução continua. */
  complete: boolean;
  /** Primeiro erro de mensagem, para `last_error`. */
  lastError: string | null;
};

type Ref = { id: string; threadId: string };

const isFatal = (e: unknown) => e instanceof GmailAuthError || e instanceof GmailRateLimitError;

/**
 * Sincroniza uma caixa.
 * - Primeira carga (`backfill_done = false`): grava o `history_id` do perfil se for nulo, pagina `messages.list`
 *   (12 meses, ou 7 dias na recuperação) guardando o cursor a cada página, e marca `backfill_done` no fim.
 * - Incremental: `history.list` a partir do `history_id`, que só avança no fim de um lote sem erros.
 *   `GmailHistoryExpiredError` reinicia a carga com os últimos 7 dias.
 * `GmailAuthError` e `GmailRateLimitError` sobem para quem chamou (o cron decide); erro de uma mensagem só é contado.
 */
export async function syncAccount(accountIn: SyncAccount, deps: SyncDeps): Promise<SyncResult> {
  const { client, store } = deps;
  const now = deps.now ?? Date.now;
  const account: SyncAccount = { ...accountIn };
  const result: SyncResult = { processed: 0, stored: 0, linked: 0, errors: 0, phase: "incremental", complete: true, lastError: null };

  let indexPromise: Promise<ContactIndex> | null = null;
  const getIndex = () => (indexPromise ??= deps.loadIndex());
  const expired = () => now() >= deps.deadline;
  const stamp = () => new Date(now()).toISOString();

  async function processOne(ref: Ref, index: ContactIndex, storedThreads: Set<string>) {
    let meta;
    try {
      meta = await client.getMessage(ref.id, "metadata");
    } catch (e) {
      if (e instanceof GmailApiError && e.status === 404) return; // apagada entre a listagem e a leitura
      throw e;
    }
    if (skipByLabels(meta.labelIds)) return;
    const links = matchMessage(messageAddresses(parseGmailMessage(meta)), account.email, index);
    if (!needsFull(links, storedThreads.has(ref.threadId))) return;
    const parsed = parseGmailMessage(await client.getMessage(ref.id, "full"));
    const r = await store.storeMessage(account, parsed, links);
    storedThreads.add(ref.threadId);
    result.stored++;
    result.linked += r.linksInserted;
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
            try {
              await processOne(ref, index, storedThreads);
            } catch (e) {
              if (isFatal(e)) throw e;
              result.errors++;
              result.lastError ??= `${ref.id}: ${e instanceof Error ? e.message : "erro"}`.slice(0, 500);
              console.error("gmail: falha ao processar mensagem", account.id, ref.id, e instanceof Error ? e.message : "erro");
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
        await store.updateAccount(account.id, { backfill_done: true, backfill_page_token: null, last_synced_at: stamp() });
        return;
      }
      cursor.pageToken = page.nextPageToken;
      account.backfill_page_token = encodeCursor(cursor.after, cursor.pageToken);
      await store.updateAccount(account.id, { backfill_page_token: account.backfill_page_token, last_synced_at: stamp() });
    }
  }

  async function incremental(): Promise<void> {
    const start = account.history_id!;
    const refs: Ref[] = [];
    let latest = start;
    let pageToken: string | undefined;
    do {
      const r = await client.listHistory({ startHistoryId: start, pageToken });
      for (const rec of r.history) for (const m of rec.messagesAdded ?? []) refs.push({ id: m.message.id, threadId: m.message.threadId });
      latest = r.historyId;
      pageToken = r.nextPageToken;
    } while (pageToken);

    const errorsBefore = result.errors;
    const done = await processRefs(refs);
    if (!done || result.errors > errorsBefore) {
      result.complete = false; // history_id fica onde está: o lote inteiro volta na próxima execução
      return;
    }
    if (latest !== account.history_id) {
      account.history_id = latest;
      await store.updateAccount(account.id, { history_id: latest });
    }
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

  await store.updateAccount(account.id, { last_synced_at: stamp(), last_error: result.lastError });
  return result;
}
