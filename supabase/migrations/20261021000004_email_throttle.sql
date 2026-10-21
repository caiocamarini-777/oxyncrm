-- Limite de envios de e-mail sem sessão (recuperação de senha).
create table public.email_send_log (
  id bigint generated always as identity primary key,
  key text not null,
  created_at timestamptz not null default now()
);
create index email_send_log_key_idx on public.email_send_log (key, created_at);
alter table public.email_send_log enable row level security;
revoke all on public.email_send_log from anon, authenticated;

create function public.consume_email_quota(p_key text, p_max int, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  delete from public.email_send_log
   where key = p_key and created_at < now() - interval '1 day';
  select count(*) into v_count from public.email_send_log
   where key = p_key and created_at > now() - p_window;
  if v_count >= p_max then
    return false;
  end if;
  insert into public.email_send_log (key) values (p_key);
  return true;
end;
$$;

revoke execute on function public.consume_email_quota(text, int, interval) from public, anon, authenticated;
grant execute on function public.consume_email_quota(text, int, interval) to service_role;
