-- Fase 6.5: modelo de dados para os painéis iguais aos do Pipedrive.
-- 1. Negócio ganha canal de origem próprio (deals.source_id, mesma lista de lead_sources da empresa).
-- 2. Resultado de atividade passa a ter alvo: 'activity' (tentativas) ou 'meeting' (qualificação da reunião
--    realizada). Reunião realizada pode ter outcome_id de alvo 'meeting'; o resto das combinações segue proibido.

-- 1. canal de origem do negócio -------------------------------------------------------------------------------
alter table public.deals add column source_id uuid references public.lead_sources on delete set null;
create index deals_source_idx on public.deals (source_id) where source_id is not null;

create function public.guard_deal_source() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.source_id is not null and
     (select company_id from public.lead_sources where id = new.source_id) is distinct from new.company_id then
    raise exception 'OXYN_CROSS_COMPANY';
  end if;
  return new;
end $$;
revoke execute on function public.guard_deal_source() from public, anon, authenticated;

create trigger guard_deal_source before insert or update of source_id, company_id on public.deals
  for each row execute function public.guard_deal_source();

-- 2. resultado da reunião -------------------------------------------------------------------------------------
alter table public.activity_outcomes
  add column applies_to text not null default 'activity' check (applies_to in ('activity', 'meeting'));

alter table public.activities drop constraint activities_check2;
alter table public.activities add constraint activities_outcome_meeting_check
  check (outcome_id is null or meeting_outcome is null or meeting_outcome = 'held');

create or replace function public.seed_company_activities(p_company uuid) returns void
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

  insert into public.activity_outcomes (company_id, name, classification, books_meeting, position, applies_to)
  select p_company, n, c, false, 100 + o, 'meeting'
  from unnest(
    array['Concluída qualificada','Concluída desqualificada','Concluída com pendência'],
    array['success','failure','neutral']
  ) with ordinality as t(n, c, o)
  on conflict (company_id, name) do nothing;
end $$;

select public.seed_company_activities(id) from public.companies;

-- complete_activity: corpo da 20261024000011; muda só a validação do resultado.
-- Reunião: meeting_outcome obrigatório; outcome_id opcional, só com held e alvo 'meeting'.
-- Demais: outcome_id obrigatório e de alvo 'activity'.
create or replace function public.complete_activity(
  p_id uuid,
  p_outcome_id uuid default null,
  p_meeting_outcome text default null,
  p_note text default null,
  p_meeting jsonb default null,
  p_next jsonb default null) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  a public.activities;
  v_meeting_type boolean;
  v_out public.activity_outcomes;
  v_outcome uuid;
  v_mo text;
  r record;
  v_meeting_id uuid;
  v_next_id uuid;
begin
  select * into a from public.activities where id = p_id and deleted_at is null for update;
  if not found or not public.can_edit_record('activities', p_id) then
    raise exception 'OXYN_NOT_FOUND';
  end if;
  if a.done then
    raise exception 'OXYN_ALREADY_DONE';
  end if;
  perform set_config('oxyn.completing', a.id::text, true);

  select is_meeting into v_meeting_type from public.activity_types where id = a.type_id;
  if v_meeting_type then
    if p_meeting_outcome is null or p_meeting_outcome not in ('held', 'no_show', 'rescheduled', 'canceled') then
      raise exception 'OXYN_OUTCOME_REQUIRED';
    end if;
    v_mo := p_meeting_outcome;
    if p_outcome_id is not null then
      if v_mo <> 'held' then
        raise exception 'OXYN_OUTCOME_REQUIRED';
      end if;
      select * into v_out from public.activity_outcomes
        where id = p_outcome_id and company_id = a.company_id and active and applies_to = 'meeting';
      if not found then
        raise exception 'OXYN_OUTCOME_REQUIRED';
      end if;
      v_outcome := v_out.id;
    end if;
  else
    if p_meeting_outcome is not null then
      raise exception 'OXYN_OUTCOME_REQUIRED';
    end if;
    select * into v_out from public.activity_outcomes
      where id = p_outcome_id and company_id = a.company_id and active and applies_to = 'activity';
    if not found then
      raise exception 'OXYN_OUTCOME_REQUIRED';
    end if;
    v_outcome := v_out.id;
  end if;

  if not v_meeting_type and v_out.books_meeting then
    if p_meeting is null or jsonb_typeof(p_meeting) <> 'object'
       or p_meeting->>'due_at' is null or p_meeting->>'subject' is null then
      raise exception 'OXYN_MEETING_REQUIRED';
    end if;
    -- reabrir e concluir de novo não duplica a reunião
    v_meeting_id := public.chain_booked_meeting(a.id);
    if v_meeting_id is null then
      v_meeting_id := public.chain_insert_activity(a.id, 'meeting', p_meeting);
    end if;
  else
    perform public.chain_booked_meeting(a.id, true);
    -- reunião remarcada: a nova reunião é opcional e herda a atribuição
    if v_meeting_type and v_mo = 'rescheduled' and p_meeting is not null then
      if jsonb_typeof(p_meeting) <> 'object' or p_meeting->>'due_at' is null or p_meeting->>'subject' is null then
        raise exception 'OXYN_MEETING_REQUIRED';
      end if;
      v_meeting_id := public.chain_insert_activity(a.id, 'meeting', p_meeting);
    end if;
  end if;

  if p_next is not null and (jsonb_typeof(p_next) <> 'object' or p_next->>'type_id' is null
     or p_next->>'channel_id' is null or p_next->>'subject' is null or p_next->>'due_at' is null) then
    raise exception 'OXYN_NEXT_ACTIVITY_REQUIRED';
  end if;
  select * into r from public.activity_next_rule(a.id);
  if p_next is null and r.rule = 'require' and r.ref_open and not r.has_open then
    raise exception 'OXYN_NEXT_ACTIVITY_REQUIRED';
  end if;
  if p_next is not null then
    v_next_id := public.chain_insert_activity(a.id, 'next', p_next);
  end if;

  update public.activities
     set done = true, completed_at = now(), outcome_id = v_outcome, meeting_outcome = v_mo,
         completion_note = nullif(btrim(p_note), '')
   where id = a.id;
  perform set_config('oxyn.completing', '', true);

  return jsonb_build_object('meeting_id', v_meeting_id, 'next_id', v_next_id, 'rule', r.rule);
end $$;
