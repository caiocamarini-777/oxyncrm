-- Fase 5 (Gmail): estado da sincronização por caixa. Só aditiva.
-- sync_failures: tentativas com erro 5xx por mensagem ({"<gmail id>": n}); a mensagem é pulada depois de 3.
-- sync_lock_until: lease da caixa, para duas execuções do cron não sincronizarem a mesma caixa ao mesmo tempo.
alter table public.email_accounts
  add column sync_failures jsonb not null default '{}',
  add column sync_lock_until timestamptz;
