-- Agenda do Google nos dois sentidos: colunas, regra de vínculo, gatilho de pendente e funções da sincronização.
-- Fica desligada por empresa (companies.settings.calendar_sync = {enabled, enabled_at}) até a virada.
--
-- Colunas novas em activities:
--   source               origem da atividade: crm (criada no CRM, padrão), pipedrive (importada; as legacy
--                        recebem pipedrive aqui e a importação grava pipedrive pelo gatilho activities_source_import)
--                        ou google_calendar (criada direto na Agenda; é a única que pode ficar sem vínculo).
--   calendar_account_id  caixa (email_accounts) em cuja Agenda está o evento.
--   calendar_event_id    id do evento na Agenda dessa caixa.
--   calendar_etag        etag da última versão do evento que o CRM gravou ou leu (a entrada ignora o mesmo etag: eco).
--   calendar_state       none (fora da fila: empresa desligada ou atividade anterior), pending (falta enviar),
--                        synced (evento em dia) ou error (o envio falhou; ver calendar_error).
--   calendar_error       mensagem do último erro de envio.
--   calendar_attempts    tentativas seguidas com erro (depois de 3, só pelo "Tentar de novo").
--   meet_url             link do Google Meet do evento.
-- Colunas novas em email_accounts:
--   calendar_sync_token  syncToken da leitura incremental da Agenda (events.list).
--   calendar_lock_until  lease da sincronização da Agenda (evita dois crons na mesma caixa).
--   calendar_since       início da sincronização da caixa (primeira rodada).
--
-- O gatilho activities_calendar_pending marca a atividade como pendente quando muda algo que aparece no evento e a
-- empresa está com a Agenda ligada. Não marca durante a importação nem sob a marca da entrada: a entrada (e a volta
-- do envio) grava pelas funções calendar_* (só service role), que fazem set_config('oxyn.calendar_inbound','on', true)
-- antes de gravar.
--
-- Ligar a Agenda só depois de desligar o modo espelho: a limpeza do espelho mandaria para a lixeira as atividades
-- criadas pela Agenda.

-- Colunas novas -------------------------------------------------------------

alter table public.activities
  add column source text not null default 'crm' check (source in ('crm','pipedrive','google_calendar')),
  add column calendar_account_id uuid references public.email_accounts on delete set null,
  add column calendar_event_id text,
  add column calendar_etag text,
  add column calendar_state text not null default 'none' check (calendar_state in ('none','pending','synced','error')),
  add column calendar_error text,
  add column calendar_attempts int not null default 0,
  add column meet_url text;

alter table public.email_accounts
  add column calendar_sync_token text,
  add column calendar_lock_until timestamptz,
  add column calendar_since timestamptz;

-- Fila do cron: atividades que falta enviar ou que falharam.
create index activities_calendar_pending_idx on public.activities (calendar_state)
  where calendar_state in ('pending','error');
-- Evento da Agenda → atividade (entrada).
create index activities_calendar_event_idx on public.activities (calendar_account_id, calendar_event_id);

-- Origem das atividades -------------------------------------------------------

-- As importadas do Pipedrive. Sem gatilhos: o set_updated_at mudaria o updated_at, que a importação usa como
-- carimbo de "editada no CRM".
alter table public.activities disable trigger user;
update public.activities set source = 'pipedrive' where legacy;
alter table public.activities enable trigger user;

create function public.activities_source_import() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.importing() then
    new.source := 'pipedrive';
  end if;
  return new;
end $$;

create trigger activities_source_import before insert on public.activities
  for each row execute function public.activities_source_import();

-- Usuário logado não escolhe a origem: com google_calendar a atividade escaparia da regra de vínculo.
create function public.activities_source_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null and not public.importing() then
    if tg_op = 'INSERT' then
      new.source := 'crm';
    else
      new.source := old.source;
    end if;
  end if;
  return new;
end $$;

create trigger activities_source_guard before insert or update on public.activities
  for each row execute function public.activities_source_guard();

-- Vínculo obrigatório: lead, negócio, pessoa ou organização, ou evento vindo da Agenda --------------

-- Confere que activities_check é mesmo a regra de vínculo antes de apagá-la.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.activities'::regclass and conname = 'activities_check'
                   and pg_get_constraintdef(oid) like '%lead_id IS NOT NULL%organization_id IS NOT NULL%') then
    raise exception 'activities_check não é a regra de vínculo obrigatório';
  end if;
end $$;

alter table public.activities drop constraint activities_check;
alter table public.activities add constraint activities_link_check
  check (lead_id is not null or deal_id is not null or person_id is not null or organization_id is not null
         or source = 'google_calendar');

-- Agenda ligada na empresa ----------------------------------------------------

-- Só o booleano true do JSON liga (como readCalendarSettings); nunca lança, para um valor fora do formato não travar
-- a gravação de atividades pelo gatilho.
create function public.calendar_sync_enabled(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (settings->'calendar_sync'->'enabled') = 'true'::jsonb
                   from public.companies where id = p_company), false)
$$;

-- Gatilho de pendente ---------------------------------------------------------

-- Marca pendente no insert e quando muda uma coluna que aparece no evento. Mudanças só em calendar_* e meet_url
-- (a volta do envio, o "Tentar de novo") não marcam.
create function public.activities_calendar_pending() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.importing() or coalesce(current_setting('oxyn.calendar_inbound', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' and not (
       new.subject is distinct from old.subject
       or new.description is distinct from old.description
       or new.due_at is distinct from old.due_at
       or new.duration_minutes is distinct from old.duration_minutes
       or new.done is distinct from old.done
       or new.meeting_outcome is distinct from old.meeting_outcome
       or new.deleted_at is distinct from old.deleted_at
       or new.owner_id is distinct from old.owner_id
       or new.person_id is distinct from old.person_id
       or new.type_id is distinct from old.type_id) then
    return new;
  end if;
  if not public.calendar_sync_enabled(new.company_id) then
    return new;
  end if;
  new.calendar_state := 'pending';
  new.calendar_attempts := 0;
  new.calendar_error := null;
  return new;
end $$;

create trigger activities_calendar_pending before insert or update on public.activities
  for each row execute function public.activities_calendar_pending();

-- Gravações da sincronização (service role) -------------------------------------
-- Todas ligam oxyn.calendar_inbound antes de gravar, para o gatilho não marcar a atividade como pendente de novo.
-- Chave ausente mantém o valor; chave com null grava null.

-- Volta do envio: só as colunas da Agenda.
create function public.calendar_mark_synced(p_activity uuid, p_fields jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  select * into r from jsonb_to_record(p_fields) as x(calendar_account_id uuid, calendar_event_id text,
    calendar_etag text, calendar_state text, calendar_error text, calendar_attempts int, meet_url text);
  perform set_config('oxyn.calendar_inbound', 'on', true);
  update public.activities a
     set calendar_account_id = case when p_fields ? 'calendar_account_id' then r.calendar_account_id else a.calendar_account_id end,
         calendar_event_id = case when p_fields ? 'calendar_event_id' then r.calendar_event_id else a.calendar_event_id end,
         calendar_etag = case when p_fields ? 'calendar_etag' then r.calendar_etag else a.calendar_etag end,
         calendar_state = case when p_fields ? 'calendar_state' then r.calendar_state else a.calendar_state end,
         calendar_error = case when p_fields ? 'calendar_error' then r.calendar_error else a.calendar_error end,
         calendar_attempts = case when p_fields ? 'calendar_attempts' then r.calendar_attempts else a.calendar_attempts end,
         meet_url = case when p_fields ? 'meet_url' then r.meet_url else a.meet_url end
   where a.id = p_activity;
  perform set_config('oxyn.calendar_inbound', '', true);
end $$;

-- Entrada: mudança feita na Agenda (horário, título, conclusão, lixeira, adoção).
create function public.calendar_apply_inbound(p_activity uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  select * into r from jsonb_to_record(p_patch) as x(subject text, due_at timestamptz, duration_minutes int,
    deleted_at timestamptz, done boolean, completed_at timestamptz, meeting_outcome text, calendar_account_id uuid,
    calendar_event_id text, calendar_etag text, calendar_state text, meet_url text);
  perform set_config('oxyn.calendar_inbound', 'on', true);
  update public.activities a
     set subject = case when p_patch ? 'subject' then r.subject else a.subject end,
         due_at = case when p_patch ? 'due_at' then r.due_at else a.due_at end,
         duration_minutes = case when p_patch ? 'duration_minutes' then r.duration_minutes else a.duration_minutes end,
         deleted_at = case when p_patch ? 'deleted_at' then r.deleted_at else a.deleted_at end,
         done = case when p_patch ? 'done' then r.done else a.done end,
         completed_at = case when p_patch ? 'completed_at' then r.completed_at else a.completed_at end,
         meeting_outcome = case when p_patch ? 'meeting_outcome' then r.meeting_outcome else a.meeting_outcome end,
         calendar_account_id = case when p_patch ? 'calendar_account_id' then r.calendar_account_id else a.calendar_account_id end,
         calendar_event_id = case when p_patch ? 'calendar_event_id' then r.calendar_event_id else a.calendar_event_id end,
         calendar_etag = case when p_patch ? 'calendar_etag' then r.calendar_etag else a.calendar_etag end,
         calendar_state = case when p_patch ? 'calendar_state' then r.calendar_state else a.calendar_state end,
         meet_url = case when p_patch ? 'meet_url' then r.meet_url else a.meet_url end
   where a.id = p_activity;
  perform set_config('oxyn.calendar_inbound', '', true);
end $$;

-- Entrada: evento novo criado direto na Agenda. Coluna ausente fica com o padrão da tabela.
create function public.calendar_insert_inbound(p_row jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
begin
  select * into r from jsonb_to_record(p_row) as x(company_id uuid, owner_id uuid, type_id uuid, channel_id uuid,
    subject text, description text, due_at timestamptz, duration_minutes int, lead_id uuid, deal_id uuid,
    person_id uuid, organization_id uuid, calendar_account_id uuid, calendar_event_id text, calendar_etag text,
    calendar_state text, calendar_error text, calendar_attempts int, meet_url text);
  perform set_config('oxyn.calendar_inbound', 'on', true);
  insert into public.activities (company_id, owner_id, created_by, source, type_id, channel_id, subject, description,
    due_at, duration_minutes, lead_id, deal_id, person_id, organization_id, calendar_account_id, calendar_event_id,
    calendar_etag, calendar_state, calendar_error, calendar_attempts, meet_url)
  values (r.company_id, r.owner_id, r.owner_id, 'google_calendar', r.type_id, r.channel_id, r.subject, r.description,
    r.due_at, coalesce(r.duration_minutes, 30), r.lead_id, r.deal_id, r.person_id, r.organization_id,
    r.calendar_account_id, r.calendar_event_id, r.calendar_etag, coalesce(r.calendar_state, 'none'), r.calendar_error,
    coalesce(r.calendar_attempts, 0), r.meet_url)
  returning id into v_id;
  perform set_config('oxyn.calendar_inbound', '', true);
  return v_id;
end $$;

-- Permissões ----------------------------------------------------------------

revoke execute on function public.activities_source_import(), public.activities_source_guard(),
  public.activities_calendar_pending() from public, anon, authenticated;
revoke execute on function public.calendar_sync_enabled(uuid), public.calendar_mark_synced(uuid, jsonb),
  public.calendar_apply_inbound(uuid, jsonb), public.calendar_insert_inbound(jsonb)
  from public, anon, authenticated;
grant execute on function public.calendar_sync_enabled(uuid), public.calendar_mark_synced(uuid, jsonb),
  public.calendar_apply_inbound(uuid, jsonb), public.calendar_insert_inbound(jsonb)
  to service_role;
