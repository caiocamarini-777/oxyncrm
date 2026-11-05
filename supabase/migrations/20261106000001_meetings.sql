-- Assistente de reuniões do Google Meet: reuniões, transcrições, notas e sugestões.
-- Migration só aditiva. As tabelas são escritas pelo service role (cron e server actions);
-- o acesso de leitura segue a visibilidade do registro vinculado (negócio, lead, pessoa ou organização).

-- Colunas novas em email_accounts ---------------------------------------------

-- Escopos OAuth concedidos à conta (para saber se já tem os do Meet e da Agenda).
alter table public.email_accounts add column scopes text[] not null default '{}';
-- Fim da última reunião já lida pela conta.
alter table public.email_accounts add column meeting_cursor timestamptz;
-- Lease própria do assistente (evita dois crons lendo a mesma conta ao mesmo tempo).
alter table public.email_accounts add column meeting_lock_until timestamptz;

-- Tabelas ------------------------------------------------------------------

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  -- Caixa que trouxe a reunião.
  account_id uuid references public.email_accounts on delete set null,
  -- O vendedor dono da reunião.
  owner_id uuid not null references public.profiles on delete cascade,
  -- Chave de idempotência (único global).
  conference_record text not null unique,
  calendar_event_id text,
  title text not null default '',
  started_at timestamptz,
  ended_at timestamptz,
  -- Convidados: [{email, name, internal}]
  attendees jsonb not null default '[]',
  status text not null default 'waiting_transcript'
    check (status in ('waiting_transcript','processing','unlinked','done','failed','ignored')),
  attempts int not null default 0,
  last_error text,
  -- Vínculo com o registro do CRM (nulo enquanto a reunião está sem vínculo).
  entity text check (entity in ('deals','leads','persons','organizations')),
  record_id uuid,
  -- Atividade de reunião agendada encontrada no CRM.
  anchor_activity_id uuid references public.activities on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((entity is null) = (record_id is null))
);
create index meetings_company_status_idx on public.meetings (company_id, status);
create index meetings_owner_idx on public.meetings (owner_id, started_at desc);
create index meetings_record_idx on public.meetings (entity, record_id) where entity is not null;
create index meetings_account_idx on public.meetings (account_id);
-- Fila do cron: reuniões que ainda esperam transcrição ou processamento.
create index meetings_pending_idx on public.meetings (ended_at) where status in ('waiting_transcript','processing');

create table public.meeting_transcripts (
  meeting_id uuid primary key references public.meetings on delete cascade,
  -- [{speaker, text, start}]
  entries jsonb not null default '[]',
  -- Transcrição corrida, até 1 MB.
  text text not null default '' check (char_length(text) <= 1048576)
);

create table public.meeting_notes (
  meeting_id uuid primary key references public.meetings on delete cascade,
  summary text not null default '',
  pains jsonb not null default '[]',
  objections jsonb not null default '[]',
  -- [{question, answer}]
  qualification jsonb not null default '[]',
  -- [{what, owner, due}]
  next_steps jsonb not null default '[]',
  model text,
  -- Resposta do Claude já validada.
  raw jsonb,
  pipedrive_note_id bigint,
  written_at timestamptz
);

create table public.meeting_suggestions (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings on delete cascade,
  kind text not null check (kind in ('meeting_outcome','next_activity','stage')),
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending','confirmed','dismissed','failed')),
  decided_by uuid references public.profiles on delete set null,
  decided_at timestamptz,
  last_error text
);
create index meeting_suggestions_meeting_idx on public.meeting_suggestions (meeting_id);

create trigger set_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();
create trigger guard_company_immutable before update on public.meetings
  for each row execute function public.guard_company_immutable();

-- Notificações: aviso de reunião sem vínculo -----------------------------------

alter table public.notifications
  add column meeting_id uuid references public.meetings on delete cascade;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('activity_reminder','meeting_unlinked'));

-- Um aviso por usuário e reunião (o unique existente não pega activity_id nulo).
create unique index notifications_meeting_kind_user_key
  on public.notifications (meeting_id, kind, user_id) where meeting_id is not null;

-- Permissões ----------------------------------------------------------------

-- Registro vinculado vivo: vale a permissão do registro. Sem vínculo (ou com o registro
-- na lixeira, estado calculado): só o dono da reunião e o admin geral.
create function public.can_read_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when m.entity is not null and exists (
        select 1 from public.record_ref(m.entity, m.record_id) r where r.deleted_at is null)
        then public.can_read_record(m.entity, m.record_id)
      else public.current_user_active() and (m.owner_id = auth.uid() or public.is_super_admin())
    end
    from public.meetings m
    where m.id = p_meeting), false);
$$;

-- Mesmo critério, com a permissão de edição do registro.
create function public.can_edit_meeting(p_meeting uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when m.entity is not null and exists (
        select 1 from public.record_ref(m.entity, m.record_id) r where r.deleted_at is null)
        then public.can_edit_record(m.entity, m.record_id)
      else public.current_user_active() and (m.owner_id = auth.uid() or public.is_super_admin())
    end
    from public.meetings m
    where m.id = p_meeting), false);
$$;

revoke execute on function public.can_read_meeting(uuid), public.can_edit_meeting(uuid) from public, anon;
grant execute on function public.can_read_meeting(uuid), public.can_edit_meeting(uuid) to authenticated;

-- RLS e grants --------------------------------------------------------------

alter table public.meetings enable row level security;
alter table public.meeting_transcripts enable row level security;
alter table public.meeting_notes enable row level security;
alter table public.meeting_suggestions enable row level security;

revoke all on public.meetings, public.meeting_transcripts, public.meeting_notes,
  public.meeting_suggestions from anon;
revoke all on public.meetings, public.meeting_transcripts, public.meeting_notes,
  public.meeting_suggestions from authenticated;

-- authenticated: só leitura (filtrada por RLS). A escrita é do service role.
grant select on public.meetings, public.meeting_transcripts, public.meeting_notes,
  public.meeting_suggestions to authenticated;
grant select, insert, update, delete on public.meetings, public.meeting_transcripts,
  public.meeting_notes, public.meeting_suggestions to service_role;

create policy meetings_select on public.meetings for select to authenticated
  using (public.can_read_meeting(id));
create policy meeting_transcripts_select on public.meeting_transcripts for select to authenticated
  using (public.can_read_meeting(meeting_id));
create policy meeting_notes_select on public.meeting_notes for select to authenticated
  using (public.can_read_meeting(meeting_id));
create policy meeting_suggestions_select on public.meeting_suggestions for select to authenticated
  using (public.can_read_meeting(meeting_id));
