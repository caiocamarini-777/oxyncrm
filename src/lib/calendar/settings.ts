/**
 * Configuração da sincronização com a Agenda do Google por empresa, guardada em
 * `companies.settings.calendar_sync` (`{enabled, enabled_at}`). Desligada por padrão: só liga no dia da virada do
 * Pipedrive. Funções puras (sem banco nem rede), para o envio, o cron e a tela usarem a mesma regra.
 */

export type CalendarSettings = {
  /** Só o booleano `true` liga (como `calendar_sync_enabled` no banco). */
  enabled: boolean;
  /** Quando a Agenda foi ligada pela última vez (ISO). Desligar não apaga: fica o histórico. */
  enabledAt: string | null;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Lê a configuração do JSON inteiro de `companies.settings`. Tolerante: valor fora do formato vale o padrão
 * (desligada), `enabled` só é verdadeiro com `true` (`"true"` e `1` não ligam) e `enabled_at` que não é uma data
 * em texto é ignorado.
 */
export function readCalendarSettings(settings: unknown): CalendarSettings {
  const raw = isObject(settings) && isObject(settings.calendar_sync) ? settings.calendar_sync : {};
  const at = raw.enabled_at;
  return {
    enabled: raw.enabled === true,
    enabledAt: typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null,
  };
}

/**
 * Devolve o JSON de `companies.settings` com `calendar_sync` trocado e as outras chaves intactas. Ligar uma Agenda
 * desligada grava `enabled_at` com `now`; ligar uma que já está ligada mantém o `enabled_at` de antes (salvar duas
 * vezes não muda a data da virada). Desligar mantém o `enabled_at` anterior, como histórico.
 */
export function withCalendarSettings(settings: unknown, enabled: boolean, now: Date): Record<string, unknown> {
  const base = isObject(settings) ? settings : {};
  const current = readCalendarSettings(base);
  const sync = isObject(base.calendar_sync) ? base.calendar_sync : {};
  const enabledAt = enabled && !current.enabled ? now.toISOString() : current.enabledAt;
  return { ...base, calendar_sync: { ...sync, enabled, enabled_at: enabledAt } };
}
