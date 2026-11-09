-- Pipedrive atualizado pelo CRM (piloto pós-virada).
-- Uma rotina de hora em hora copia para o Pipedrive o que foi criado, mudado ou apagado no CRM.
--
-- * pipedrive_push_settings: liga/desliga da rotina e o cursor (até onde as mudanças já foram enviadas). Linha única.
-- * pipedrive_push_runs: relatório de cada rodada (contadores e até 500 erros).
-- * pipedrive_push_retry: registros que falharam e entram de novo na rodada seguinte (pk entity + record_id).
-- * pipedrive_push_link / pipedrive_push_unlink: únicas escritas da rotina em external_ids (a tabela só aceita
--   escrita por funções definer). O vínculo gravado aqui não tem job (job_id nulo).
-- As três tabelas são lidas e escritas só pelo service role; os usuários não as veem.

-- Tabelas --------------------------------------------------------------------------------------------
create table public.pipedrive_push_settings (
  id int primary key check (id = 1),
  enabled boolean not null default false,
  enabled_at timestamptz,
  cursor timestamptz
);
insert into public.pipedrive_push_settings (id) values (1);

create table public.pipedrive_push_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cursor_from timestamptz,
  cursor_to timestamptz,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  counters jsonb not null default '{}',
  errors jsonb not null default '[]' check (jsonb_typeof(errors) = 'array')
);
create index pipedrive_push_runs_started_idx on public.pipedrive_push_runs (started_at desc);

-- attempts: a linha só existe depois da primeira falha, então já nasce com 1
create table public.pipedrive_push_retry (
  entity text not null,
  record_id uuid not null,
  company_id uuid not null references public.companies on delete cascade,
  attempts int not null default 1 check (attempts >= 1),
  last_error text,
  updated_at timestamptz not null default now(),
  primary key (entity, record_id)
);

-- RLS e grants ---------------------------------------------------------------------------------------
alter table public.pipedrive_push_settings enable row level security;
alter table public.pipedrive_push_runs enable row level security;
alter table public.pipedrive_push_retry enable row level security;

-- Sem policy para authenticated: com RLS ligada ninguém além do service role (que ignora RLS) lê ou escreve.
revoke all on public.pipedrive_push_settings, public.pipedrive_push_runs, public.pipedrive_push_retry
  from anon, authenticated;
grant all on public.pipedrive_push_settings, public.pipedrive_push_runs, public.pipedrive_push_retry
  to service_role;

-- Vínculos -------------------------------------------------------------------------------------------
-- Grava/atualiza o vínculo registro do CRM <-> id no Pipedrive, com o carimbo do registro (mesma conta de import_link).
create function public.pipedrive_push_link(p_entity text, p_external_id text, p_company uuid, p_record uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_upd timestamptz;
begin
  execute format('select updated_at from public.%I where id = $1', p_entity) into v_upd using p_record;
  insert into public.external_ids (source, entity, external_id, company_id, record_id, job_id, record_updated_at)
  values ('pipedrive', p_entity, p_external_id, p_company, p_record, null, v_upd)
  on conflict (source, entity, external_id, company_id) do update
    set record_id = excluded.record_id, job_id = null,
        record_updated_at = excluded.record_updated_at, imported_at = now();
end $$;

-- Remove os vínculos do registro (apagado no Pipedrive, ou apagado de vez no CRM)
create function public.pipedrive_push_unlink(p_entity text, p_record uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.external_ids
   where source = 'pipedrive' and entity = p_entity and record_id = p_record;
end $$;

revoke execute on function public.pipedrive_push_link(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pipedrive_push_link(text, text, uuid, uuid) to service_role;
revoke execute on function public.pipedrive_push_unlink(text, uuid) from public, anon, authenticated;
grant execute on function public.pipedrive_push_unlink(text, uuid) to service_role;
