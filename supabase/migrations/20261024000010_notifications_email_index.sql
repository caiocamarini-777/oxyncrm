-- Índice parcial para a rota de lembretes por e-mail (notificações ainda sem e-mail enviado).
create index notifications_email_pending_idx on public.notifications (created_at)
  where email_sent_at is null and kind = 'activity_reminder';
