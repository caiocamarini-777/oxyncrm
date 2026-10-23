-- Schema de atividades, catálogos por empresa e notificações. RLS ligado sem policies (deny-all); policies na Task 2.

create table public.activity_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  is_meeting boolean not null default false,
  position int not null default 0,
  active boolean not null default true,
  unique (company_id, name)
);

create table public.activity_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  position int not null default 0,
  active boolean not null default true,
  is_legacy boolean not null default false,
  unique (company_id, name)
);

create table public.activity_outcomes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  classification text not null check (classification in ('success','neutral','failure')),
  books_meeting boolean not null default false,
  position int not null default 0,
  active boolean not null default true,
  unique (company_id, name)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  owner_id uuid not null references public.profiles,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  type_id uuid not null references public.activity_types on delete restrict,
  channel_id uuid not null references public.activity_channels on delete restrict,
  subject text not null check (char_length(subject) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  due_at timestamptz not null,
  duration_minutes int not null default 30 check (duration_minutes between 0 and 1440),
  done boolean not null default false,
  completed_at timestamptz,
  outcome_id uuid references public.activity_outcomes on delete restrict,
  meeting_outcome text check (meeting_outcome in ('held','no_show','rescheduled','canceled')),
  completion_note text check (completion_note is null or char_length(completion_note) <= 2000),
  lead_id uuid references public.leads on delete set null,
  deal_id uuid references public.deals on delete set null,
  person_id uuid references public.persons on delete set null,
  organization_id uuid references public.organizations on delete set null,
  reminder_minutes int check (reminder_minutes is null or reminder_minutes between 0 and 10080),
  reminder_sent_at timestamptz,
  booked_by_activity_id uuid references public.activities on delete set null,
  origin_channel_id uuid references public.activity_channels on delete set null,
  legacy boolean not null default false,
  check (lead_id is not null or deal_id is not null or person_id is not null or organization_id is not null),
  check (done = (completed_at is not null)),
  check (not (outcome_id is not null and meeting_outcome is not null))
);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles on delete cascade,
  company_id uuid references public.companies on delete cascade,
  kind text not null check (kind in ('activity_reminder')),
  activity_id uuid references public.activities on delete cascade,
  title text not null,
  body text,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_sent_at timestamptz,
  unique (activity_id, kind, due_at)
);

-- Eventos de atividade na linha do tempo
alter table public.timeline_events drop constraint timeline_events_kind_check;
alter table public.timeline_events add constraint timeline_events_kind_check
  check (kind in ('created','updated','owner_changed','status_changed','note_added',
    'label_added','label_removed','trashed','restored','stage_changed','converted',
    'activity_scheduled','activity_completed'));

-- Índices
create index activities_agenda_idx on public.activities (company_id, owner_id, due_at)
  where deleted_at is null and not done;
create index activities_lead_idx on public.activities (lead_id);
create index activities_deal_idx on public.activities (deal_id);
create index activities_person_idx on public.activities (person_id);
create index activities_organization_idx on public.activities (organization_id);
create index activities_reminder_idx on public.activities (due_at)
  where not done and reminder_minutes is not null and reminder_sent_at is null;
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create trigger set_updated_at before update on public.activities
  for each row execute function public.set_updated_at();

-- Referências precisam ser da mesma empresa (função completa, com todos os ramos anteriores intactos)
create or replace function public.guard_same_company() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j jsonb := to_jsonb(new);
  rec_company uuid;
  label_company uuid;
begin
  if tg_table_name = 'persons' then
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'leads' then
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.source_id is not null and
       (select company_id from public.lead_sources where id = new.source_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.disqualification_reason_id is not null and
       (select company_id from public.disqualification_reasons where id = new.disqualification_reason_id)
         is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.converted_deal_id is not null and
       (select company_id from public.deals where id = new.converted_deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'deals' then
    if (select company_id from public.pipelines where id = new.pipeline_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if not exists (select 1 from public.stages
                   where id = new.stage_id and company_id = new.company_id and pipeline_id = new.pipeline_id) then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lost_reason_id is not null and
       (select company_id from public.lost_reasons where id = new.lost_reason_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lead_id is not null and
       (select company_id from public.leads where id = new.lead_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'activities' then
    if (select company_id from public.activity_types where id = new.type_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if (select company_id from public.activity_channels where id = new.channel_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.origin_channel_id is not null and
       (select company_id from public.activity_channels where id = new.origin_channel_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.outcome_id is not null and
       (select company_id from public.activity_outcomes where id = new.outcome_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.lead_id is not null and
       (select company_id from public.leads where id = new.lead_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.deal_id is not null and
       (select company_id from public.deals where id = new.deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.person_id is not null and
       (select company_id from public.persons where id = new.person_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.organization_id is not null and
       (select company_id from public.organizations where id = new.organization_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if new.booked_by_activity_id is not null and
       (select company_id from public.activities where id = new.booked_by_activity_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'stages' then
    if (select company_id from public.pipelines where id = new.pipeline_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'deal_items' then
    if (select company_id from public.deals where id = new.deal_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
    if (select company_id from public.products where id = new.product_id) is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name in ('notes','record_labels') and
        coalesce(j->>'entity', '') not in ('leads','persons','organizations','deals') then
    return new; -- o CHECK de entity rejeita
  elsif tg_table_name = 'notes' then
    execute format('select company_id from public.%I where id = $1', j->>'entity')
      into rec_company using (j->>'record_id')::uuid;
    if rec_company is distinct from new.company_id then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  elsif tg_table_name = 'record_labels' then
    select company_id into label_company from public.labels where id = new.label_id;
    execute format('select company_id from public.%I where id = $1', new.entity)
      into rec_company using new.record_id;
    if rec_company is null or label_company is distinct from rec_company then
      raise exception 'OXYN_CROSS_COMPANY';
    end if;
  end if;
  return new;
end $$;

create trigger guard_same_company before insert or update on public.activities
  for each row execute function public.guard_same_company();

-- Realtime: notificações chegam ao navegador
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- Seeds: tipos, canais e resultados padrão (idempotente)
create function public.seed_company_activities(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.activity_types (company_id, name, is_meeting, position)
  select p_company, n, n = 'Reunião', o - 1
  from unnest(array['Tarefa','Ligação','Reunião','E-mail','Mensagem']) with ordinality as t(n, o)
  on conflict (company_id, name) do nothing;

  insert into public.activity_channels (company_id, name, position, active, is_legacy)
  select p_company, n, o - 1, n <> 'Não informado', n = 'Não informado'
  from unnest(array['E-mail','Telefone','LinkedIn','WhatsApp','Videochamada','Presencial','Não informado'])
    with ordinality as t(n, o)
  on conflict (company_id, name) do nothing;

  insert into public.activity_outcomes (company_id, name, classification, books_meeting, position)
  select p_company, n, c, n = 'Reunião agendada', o - 1
  from unnest(
    array['Sem resposta','Número ou perfil inválido','Respondeu, sem interesse','Respondeu, pediu retorno','Conversa realizada','Reunião agendada'],
    array['failure','failure','failure','neutral','success','success']
  ) with ordinality as t(n, c, o)
  on conflict (company_id, name) do nothing;
end $$;

create function public.seed_company_activities_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_company_activities(new.id);
  return new;
end $$;

create trigger seed_company_activities after insert on public.companies
  for each row execute function public.seed_company_activities_trigger();

select public.seed_company_activities(id) from public.companies;

revoke execute on function public.seed_company_activities(uuid), public.seed_company_activities_trigger(),
  public.guard_same_company() from public, anon, authenticated;

-- RLS ligado, sem policies (deny-all); anon nunca toca nestas tabelas.
alter table public.activity_types enable row level security;
alter table public.activity_channels enable row level security;
alter table public.activity_outcomes enable row level security;
alter table public.activities enable row level security;
alter table public.notifications enable row level security;

revoke all on public.activity_types, public.activity_channels, public.activity_outcomes,
  public.activities, public.notifications from anon;
revoke truncate, references, trigger on public.activity_types, public.activity_channels,
  public.activity_outcomes, public.activities, public.notifications from authenticated;
