-- Pipedrive atualizado pelo CRM (piloto pós-virada).
-- Uma rotina de hora em hora copia para o Pipedrive o que foi criado, mudado ou apagado no CRM.
--
-- * pipedrive_push_settings: liga/desliga da rotina e os cursores (até onde as mudanças já foram enviadas). Linha única.
--   `cursor` é o cursor inicial comum, gravado ao ligar; `cursors` guarda o de cada entidade, que a rodada avança
--   ({"organizations": {"at": "<updated_at>", "id": "<uuid, se parou no meio do mesmo updated_at>"}, ...}). A entidade
--   sem cursor próprio começa no inicial.
-- * pipedrive_push_runs: relatório de cada rodada (contadores, até 500 erros e os avisos). cursor_from/cursor_to: o
--   mais antigo dos cursores por entidade no início e no fim.
-- * pipedrive_push_retry: registros que falharam (ou que precisam ir de novo) e entram na rodada seguinte
--   (pk entity + record_id).
-- * pipedrive_push_link / pipedrive_push_unlink: únicas escritas da rotina em external_ids (a tabela só aceita
--   escrita por funções definer). O vínculo gravado aqui não tem job (job_id nulo).
-- As três tabelas são lidas e escritas só pelo service role; os usuários não as veem.

-- Tabelas --------------------------------------------------------------------------------------------
create table public.pipedrive_push_settings (
  id int primary key check (id = 1),
  enabled boolean not null default false,
  enabled_at timestamptz,
  cursor timestamptz,
  cursors jsonb not null default '{}' check (jsonb_typeof(cursors) = 'object')
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
  errors jsonb not null default '[]' check (jsonb_typeof(errors) = 'array'),
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array')
);
create index pipedrive_push_runs_started_idx on public.pipedrive_push_runs (started_at desc);

-- attempts: falhas do registro. Nasce com 1 na primeira falha, ou com 0 quando o registro só precisa ir de novo (a
-- atividade ou anotação de um registro criado de novo no Pipedrive).
create table public.pipedrive_push_retry (
  entity text not null,
  record_id uuid not null,
  company_id uuid not null references public.companies on delete cascade,
  attempts int not null default 1 check (attempts >= 0),
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
-- As duas funções só aceitam as entidades que a rotina envia (em pipedrive_push_link o nome vira tabela no format).
-- Grava/atualiza o vínculo registro do CRM <-> id no Pipedrive, com o carimbo do registro (mesma conta de import_link).
create function public.pipedrive_push_link(p_entity text, p_external_id text, p_company uuid, p_record uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_upd timestamptz;
begin
  if p_entity is null or p_entity not in ('organizations', 'persons', 'leads', 'deals', 'activities', 'notes') then
    raise exception 'entidade inválida para a atualização do Pipedrive: %', coalesce(p_entity, 'nula');
  end if;
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
  if p_entity is null or p_entity not in ('organizations', 'persons', 'leads', 'deals', 'activities', 'notes') then
    raise exception 'entidade inválida para a atualização do Pipedrive: %', coalesce(p_entity, 'nula');
  end if;
  delete from public.external_ids
   where source = 'pipedrive' and entity = p_entity and record_id = p_record;
end $$;

revoke execute on function public.pipedrive_push_link(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pipedrive_push_link(text, text, uuid, uuid) to service_role;
revoke execute on function public.pipedrive_push_unlink(text, uuid) from public, anon, authenticated;
grant execute on function public.pipedrive_push_unlink(text, uuid) to service_role;
