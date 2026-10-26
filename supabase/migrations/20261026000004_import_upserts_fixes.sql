-- Fase 3.5, task 2, rodada de correções 1 (sobre 20261026000003).
-- * Dono (owner_id) precisa ser membro da empresa; autor de anotação cai para quem criou o job.
-- * Avisos em import_jobs.warnings, separados de errors (cada lista com no máximo 1000 itens).
-- * Linha igual à gravada não altera o registro (updated_at estável): o UPDATE roda num subbloco que é
--   desfeito quando a foto do registro (sem updated_at) não muda. Assim a comparação enxerga exatamente o que
--   os triggers gravariam (contatos normalizados, campos derivados), sem duplicar regras.
-- * Troca de etapa na reimportação grava deal_stage_history; mudança de won_at recalcula as datas do contrato.
-- * Produtos só casam por external_id; resultado "Importado" só é reaproveitado se inativo e neutro.
-- * import_find ignora registros na lixeira; a reconstrução não refaz o cronograma (o trigger já faz).

-- 1. Avisos separados ------------------------------------------------------------------------------------------
alter table public.import_jobs
  add column warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array');

-- import_log_error (corpo de 20261026000003): "aviso:" vai para warnings, o resto para errors
create or replace function public.import_log_error(p_job uuid, p_entity text, p_external_id text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_entity text := coalesce(p_entity, 'unknown');
  v_warning boolean := coalesce(p_reason, '') like 'aviso:%';
  v_key text := case when v_warning then 'warnings' else 'errors' end;
  v_item jsonb := jsonb_build_array(jsonb_build_object(
    'entity', v_entity, 'external_id', p_external_id, 'reason', left(p_reason, 1000)));
begin
  update public.import_jobs
     set errors = case when not v_warning and jsonb_array_length(errors) < 1000 then errors || v_item else errors end,
         warnings = case when v_warning and jsonb_array_length(warnings) < 1000 then warnings || v_item else warnings end,
         counters = jsonb_set(counters, array[v_entity],
           (case when jsonb_typeof(counters->v_entity) = 'object' then counters->v_entity else '{}'::jsonb end)
           || jsonb_build_object(v_key, coalesce((counters->v_entity->>v_key)::int, 0) + 1))
   where id = p_job;
end $$;
revoke execute on function public.import_log_error(uuid, text, text, text) from public, anon, authenticated, service_role;

-- 2. Auxiliares --------------------------------------------------------------------------------------------------
-- import_find (corpo de 20261026000003): registro na lixeira não é resolvido
create or replace function public.import_find(p_entity text, p_ext text, p_company uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v uuid;
begin
  if coalesce(p_ext, '') = '' or p_company is null then
    return null;
  end if;
  select record_id into v from public.external_ids
   where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = p_company;
  if v is null then
    return null;
  end if;
  execute format('select id from public.%I where id = $1 and company_id = $2 and deleted_at is null', p_entity)
    into v using v, p_company;
  return v;
end $$;

-- Dono precisa ser membro (ou admin geral) ativo da empresa
create function public.import_owner(p_company uuid, p_owner uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_owner is null or p_company is null or not public.owner_has_membership(p_company, p_owner) then
    raise exception 'OXYN_IMPORT_INVALID' using detail = 'owner_id';
  end if;
  return p_owner;
end $$;

-- Linha igual à gravada: só renova o job do vínculo (record_updated_at continua igual a updated_at)
create function public.import_unchanged(p_job uuid, p_entity text, p_ext text, p_company uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.external_ids set job_id = p_job
   where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = p_company;
  return 'unchanged';
end $$;

-- import_outcome (corpo de 20261026000003): reaproveita só "Importado" inativo e neutro; senão usa
-- "Importado (Pipedrive)", com a mesma exigência
create or replace function public.import_outcome(p_company uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v uuid;
  v_name text;
begin
  foreach v_name in array array['Importado', 'Importado (Pipedrive)'] loop
    select id into v from public.activity_outcomes
     where company_id = p_company and name = v_name and not active and classification = 'neutral';
    if v is not null then
      return v;
    end if;
    if not exists (select 1 from public.activity_outcomes where company_id = p_company and name = v_name) then
      insert into public.activity_outcomes (company_id, name, classification, books_meeting, position, active)
      values (p_company, v_name, 'neutral', false,
              (select coalesce(max(position) + 1, 0) from public.activity_outcomes where company_id = p_company), false)
      on conflict (company_id, name) do nothing returning id into v;
      if v is not null then
        return v;
      end if;
    end if;
  end loop;
  raise exception 'OXYN_IMPORT_NO_OUTCOME';
end $$;

-- 3. Organizações (corpo de 20261026000003) -------------------------------------------------------------------------
create or replace function public.import_upsert_organizations(p_job uuid, p_row jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
  v_stale boolean;
  v_before jsonb;
  v_cf jsonb;
  v_name text;
  v_addr jsonb;
  v_created timestamptz;
begin
  select * into r from jsonb_to_record(p_row) as x(external_id text, company_id uuid, owner_id uuid, name text,
    address jsonb, custom_fields jsonb, created_at timestamptz);
  perform public.import_required(r.external_id, 'external_id');
  perform public.import_owner(r.company_id, r.owner_id);
  v_name := left(public.import_required(r.name, 'name'), 200);
  v_addr := case jsonb_typeof(r.address)
              when 'object' then r.address
              when 'string' then case when btrim(r.address #>> '{}') = '' then '{}'::jsonb
                                      else jsonb_build_object('street', btrim(r.address #>> '{}')) end
              else '{}'::jsonb end;
  v_created := coalesce(r.created_at, now());

  select o_id, o_stale into v_id, v_stale from public.import_state('organizations', r.external_id, r.company_id);
  if v_stale then
    return 'skipped';
  end if;
  v_cf := public.import_custom_fields(p_job, 'organizations', r.external_id, r.company_id, r.custom_fields);
  if v_id is null then
    insert into public.organizations (company_id, owner_id, name, address, custom_fields, created_at)
    values (r.company_id, r.owner_id, v_name, v_addr, coalesce(v_cf, '{}'), v_created)
    returning id into v_id;
    perform public.import_link(p_job, 'organizations', r.external_id, r.company_id, v_id);
    return 'created';
  end if;
  v_before := public.import_snapshot('organizations', v_id);
  begin
    update public.organizations o
       set owner_id = r.owner_id, name = v_name, address = v_addr,
           custom_fields = o.custom_fields || coalesce(v_cf, '{}'), created_at = v_created
     where o.id = v_id;
    if public.import_snapshot('organizations', v_id) = v_before then
      raise exception using errcode = 'OXNOP';
    end if;
  exception when sqlstate 'OXNOP' then
    return public.import_unchanged(p_job, 'organizations', r.external_id, r.company_id);
  end;
  perform public.import_link(p_job, 'organizations', r.external_id, r.company_id, v_id);
  return 'updated';
end $$;

-- 4. Pessoas (corpo de 20261026000003) -----------------------------------------------------------------------------
create or replace function public.import_upsert_persons(p_job uuid, p_row jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
  v_stale boolean;
  v_before jsonb;
  v_cf jsonb;
  v_name text;
  v_org uuid;
  v_created timestamptz;
begin
  select * into r from jsonb_to_record(p_row) as x(external_id text, company_id uuid, owner_id uuid, name text,
    emails jsonb, phones jsonb, organization_external_id text, custom_fields jsonb, created_at timestamptz);
  perform public.import_required(r.external_id, 'external_id');
  perform public.import_owner(r.company_id, r.owner_id);
  v_name := left(public.import_required(r.name, 'name'), 200);
  v_org := public.import_find('organizations', r.organization_external_id, r.company_id);
  v_created := coalesce(r.created_at, now());

  select o_id, o_stale into v_id, v_stale from public.import_state('persons', r.external_id, r.company_id);
  if v_stale then
    return 'skipped';
  end if;
  v_cf := public.import_custom_fields(p_job, 'persons', r.external_id, r.company_id, r.custom_fields);
  if v_id is null then
    insert into public.persons (company_id, owner_id, full_name, emails, phones, organization_id, custom_fields, created_at)
    values (r.company_id, r.owner_id, v_name, public.import_contacts(r.emails), public.import_contacts(r.phones),
            v_org, coalesce(v_cf, '{}'), v_created)
    returning id into v_id;
    perform public.import_link(p_job, 'persons', r.external_id, r.company_id, v_id);
    return 'created';
  end if;
  v_before := public.import_snapshot('persons', v_id);
  begin
    update public.persons p
       set owner_id = r.owner_id, full_name = v_name, emails = public.import_contacts(r.emails),
           phones = public.import_contacts(r.phones), organization_id = v_org,
           custom_fields = p.custom_fields || coalesce(v_cf, '{}'), created_at = v_created
     where p.id = v_id;
    if public.import_snapshot('persons', v_id) = v_before then
      raise exception using errcode = 'OXNOP';
    end if;
  exception when sqlstate 'OXNOP' then
    return public.import_unchanged(p_job, 'persons', r.external_id, r.company_id);
  end;
  perform public.import_link(p_job, 'persons', r.external_id, r.company_id, v_id);
  return 'updated';
end $$;

-- 5. Leads (corpo de 20261026000003) --------------------------------------------------------------------------------
create or replace function public.import_upsert_leads(p_job uuid, p_row jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
  v_stale boolean;
  v_before jsonb;
  v_cf jsonb;
  v_title text;
  v_status text;
  v_person uuid;
  v_org uuid;
  v_source uuid;
  v_created timestamptz;
  v_label text;
  v_label_id uuid;
  v_result text;
begin
  select * into r from jsonb_to_record(p_row) as x(external_id text, company_id uuid, owner_id uuid, title text,
    value numeric, person_external_id text, organization_external_id text, source_name text, labels jsonb,
    status text, custom_fields jsonb, created_at timestamptz);
  perform public.import_required(r.external_id, 'external_id');
  perform public.import_owner(r.company_id, r.owner_id);
  v_title := left(public.import_required(r.title, 'title'), 200);
  v_status := coalesce(r.status, 'open');
  if v_status not in ('open', 'archived') then
    raise exception 'OXYN_IMPORT_INVALID' using detail = 'status';
  end if;
  v_person := public.import_find('persons', r.person_external_id, r.company_id);
  v_org := public.import_find('organizations', r.organization_external_id, r.company_id);
  v_created := coalesce(r.created_at, now());

  select o_id, o_stale into v_id, v_stale from public.import_state('leads', r.external_id, r.company_id);
  if v_stale then
    return 'skipped';
  end if;
  v_cf := public.import_custom_fields(p_job, 'leads', r.external_id, r.company_id, r.custom_fields);
  v_source := public.import_named('lead_sources', r.company_id, r.source_name);
  if v_id is null then
    insert into public.leads (company_id, owner_id, title, estimated_value, person_id, organization_id, source_id,
                              status, custom_fields, created_at)
    values (r.company_id, r.owner_id, v_title, r.value, v_person, v_org, v_source, v_status,
            coalesce(v_cf, '{}'), v_created)
    returning id into v_id;
    v_result := 'created';
  else
    v_before := public.import_snapshot('leads', v_id);
    begin
      -- lead convertido (pela importação do negócio) ou desqualificado não volta a aberto/arquivado
      update public.leads l
         set owner_id = r.owner_id, title = v_title, estimated_value = r.value, person_id = v_person,
             organization_id = v_org, source_id = v_source,
             status = case when l.status in ('converted', 'disqualified') then l.status else v_status end,
             custom_fields = l.custom_fields || coalesce(v_cf, '{}'), created_at = v_created
       where l.id = v_id;
      if public.import_snapshot('leads', v_id) = v_before then
        raise exception using errcode = 'OXNOP';
      end if;
      v_result := 'updated';
    exception when sqlstate 'OXNOP' then
      v_result := 'unchanged';
    end;
  end if;

  -- etiquetas: reaproveitadas pelo nome ou criadas; só acrescenta (não mexe em leads.updated_at)
  if jsonb_typeof(r.labels) = 'array' then
    for v_label in select e #>> '{}' from jsonb_array_elements(r.labels) e where jsonb_typeof(e) = 'string' loop
      v_label_id := public.import_named('labels', r.company_id, v_label);
      if v_label_id is not null then
        insert into public.record_labels (label_id, entity, record_id) values (v_label_id, 'leads', v_id)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  if v_result = 'unchanged' then
    return public.import_unchanged(p_job, 'leads', r.external_id, r.company_id);
  end if;
  perform public.import_link(p_job, 'leads', r.external_id, r.company_id, v_id);
  return v_result;
end $$;

-- 6. Negócios (corpo de 20261026000003) -------------------------------------------------------------------------------
-- mrr_start e setup_first_due são sempre derivados (mês de won_at, senão expected_close_date, senão created_at):
-- na reimportação o registro não foi editado no CRM (regra de skip), então as datas são da importação e
-- acompanham um won_at novo. Troca de etapa grava deal_stage_history (o trigger fica suprimido no desvio).
create or replace function public.import_upsert_deals(p_job uuid, p_row jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
  v_stale boolean;
  v_before jsonb;
  v_cf jsonb;
  v_title text;
  v_status text;
  v_reason uuid;
  v_person uuid;
  v_org uuid;
  v_lead uuid;
  v_created timestamptz;
  v_mrr numeric;
  v_months int;
  v_setup numeric;
  v_ref date;
  v_result text;
  v_old_stage uuid;
  v_old_entered timestamptz;
  v_new_entered timestamptz;
  v_lead_status text;
  v_lead_upd timestamptz;
  v_lead_new timestamptz;
begin
  select * into r from jsonb_to_record(p_row) as x(external_id text, company_id uuid, owner_id uuid, pipeline_id uuid,
    stage_id uuid, title text, status text, value numeric, setup_total numeric, mrr numeric, contract_months int,
    expected_close_date date, won_at timestamptz, lost_at timestamptz, lost_reason text, stage_entered_at timestamptz,
    person_external_id text, organization_external_id text, lead_external_id text, custom_fields jsonb,
    created_at timestamptz);
  perform public.import_required(r.external_id, 'external_id');
  perform public.import_owner(r.company_id, r.owner_id);
  v_title := left(public.import_required(r.title, 'title'), 200);
  v_status := coalesce(r.status, 'open');
  if v_status not in ('open', 'won', 'lost') then
    raise exception 'OXYN_IMPORT_INVALID' using detail = 'status';
  end if;
  v_person := public.import_find('persons', r.person_external_id, r.company_id);
  v_org := public.import_find('organizations', r.organization_external_id, r.company_id);
  v_lead := public.import_find('leads', r.lead_external_id, r.company_id);
  v_created := coalesce(r.created_at, now());

  select o_id, o_stale into v_id, v_stale from public.import_state('deals', r.external_id, r.company_id);
  if v_stale then
    return 'skipped';
  end if;

  v_cf := public.import_custom_fields(p_job, 'deals', r.external_id, r.company_id, r.custom_fields);
  if v_status = 'lost' then
    v_reason := public.import_named('lost_reasons', r.company_id, coalesce(nullif(btrim(r.lost_reason), ''), 'Importado sem motivo'));
  end if;
  v_mrr := coalesce(r.mrr, 0);
  v_setup := coalesce(r.setup_total, 0);
  v_months := r.contract_months;
  if v_months is not null and v_months not between 1 and 120 then
    v_months := null;
  end if;
  if v_mrr > 0 and v_months is null then
    perform public.import_warn(p_job, 'deals', r.external_id,
      'contrato inválido (MRR sem prazo de 1 a 120 meses): gravado com MRR 0; mrr = ' || r.mrr
      || ', contract_months = ' || coalesce(r.contract_months::text, 'vazio'));
    v_mrr := 0;
  end if;
  v_ref := date_trunc('month', coalesce(r.won_at, r.expected_close_date::timestamptz, v_created))::date;

  if v_id is null then
    insert into public.deals (company_id, owner_id, pipeline_id, stage_id, title, status, estimated_value,
      setup_total, setup_installments, setup_first_due, mrr, mrr_start, contract_months, expected_close_date,
      won_at, lost_at, lost_reason_id, stage_entered_at, person_id, organization_id, lead_id, custom_fields, created_at)
    values (r.company_id, r.owner_id, r.pipeline_id, r.stage_id, v_title, v_status, r.value,
      v_setup, 1, case when v_setup > 0 then v_ref end, v_mrr, case when v_mrr > 0 then v_ref end, v_months,
      r.expected_close_date, r.won_at, r.lost_at, v_reason, r.stage_entered_at, v_person, v_org, v_lead,
      coalesce(v_cf, '{}'), v_created)
    returning id into v_id;
    v_result := 'created';
  else
    v_before := public.import_snapshot('deals', v_id);
    v_old_stage := (v_before->>'stage_id')::uuid;
    v_old_entered := (v_before->>'stage_entered_at')::timestamptz;
    begin
      update public.deals d
         set owner_id = r.owner_id, pipeline_id = r.pipeline_id, stage_id = r.stage_id, title = v_title,
             status = v_status, estimated_value = r.value, setup_total = v_setup,
             setup_first_due = case when v_setup > 0 then v_ref end,
             mrr = v_mrr, mrr_start = case when v_mrr > 0 then v_ref end,
             contract_months = v_months, expected_close_date = r.expected_close_date,
             won_at = coalesce(r.won_at, d.won_at), lost_at = coalesce(r.lost_at, d.lost_at), lost_reason_id = v_reason,
             stage_entered_at = case when r.stage_id is distinct from d.stage_id then coalesce(r.stage_entered_at, now())
                                     else coalesce(r.stage_entered_at, d.stage_entered_at) end,
             person_id = v_person, organization_id = v_org, lead_id = v_lead,
             custom_fields = d.custom_fields || coalesce(v_cf, '{}'), created_at = v_created
       where d.id = v_id
       returning stage_entered_at into v_new_entered;
      if public.import_snapshot('deals', v_id) = v_before then
        raise exception using errcode = 'OXNOP';
      end if;
      v_result := 'updated';
    exception when sqlstate 'OXNOP' then
      v_result := 'unchanged';
    end;
    if v_result = 'updated' and r.stage_id is distinct from v_old_stage then
      insert into public.deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_by, moved_at,
                                             seconds_in_previous)
      values (v_id, r.company_id, v_old_stage, r.stage_id, null, v_new_entered,
              floor(extract(epoch from (v_new_entered - v_old_entered)))::int);
    end if;
  end if;

  -- lead que virou este negócio: convertido, ligado e com a data de criação do negócio. O carimbo do vínculo do
  -- lead acompanha a conversão (não é edição no CRM), salvo se o lead já estava editado no CRM.
  if v_lead is not null then
    select status, updated_at into v_lead_status, v_lead_upd from public.leads where id = v_lead;
    if v_lead_status in ('open', 'archived') then
      update public.leads set status = 'converted', converted_deal_id = v_id, converted_at = v_created
       where id = v_lead returning updated_at into v_lead_new;
      update public.external_ids set record_updated_at = v_lead_new
       where source = 'pipedrive' and entity = 'leads' and company_id = r.company_id and record_id = v_lead
         and record_updated_at = v_lead_upd;
    end if;
  end if;

  if v_result = 'unchanged' then
    return public.import_unchanged(p_job, 'deals', r.external_id, r.company_id);
  end if;
  perform public.import_link(p_job, 'deals', r.external_id, r.company_id, v_id);
  return v_result;
end $$;

-- 7. Atividades (corpo de 20261026000003) -----------------------------------------------------------------------------
create or replace function public.import_upsert_activities(p_job uuid, p_row jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
  v_stale boolean;
  v_before jsonb;
  v_type uuid;
  v_meeting boolean;
  v_channel uuid;
  v_done boolean;
  v_completed timestamptz;
  v_due timestamptz;
  v_outcome uuid;
  v_meeting_outcome text;
  v_deal uuid;
  v_lead uuid;
  v_person uuid;
  v_org uuid;
  v_subject text;
  v_created timestamptz;
  v_old record;
begin
  select * into r from jsonb_to_record(p_row) as x(external_id text, company_id uuid, owner_id uuid, type text,
    channel_name text, subject text, due_at timestamptz, done boolean, completed_at timestamptz,
    meeting_outcome text, note text, deal_external_id text, lead_external_id text, person_external_id text,
    organization_external_id text, created_at timestamptz);
  perform public.import_required(r.external_id, 'external_id');
  perform public.import_owner(r.company_id, r.owner_id);

  v_deal := public.import_find('deals', r.deal_external_id, r.company_id);
  v_lead := public.import_find('leads', r.lead_external_id, r.company_id);
  v_person := public.import_find('persons', r.person_external_id, r.company_id);
  v_org := public.import_find('organizations', r.organization_external_id, r.company_id);
  if v_deal is null and v_lead is null and v_person is null and v_org is null then
    raise exception 'OXYN_IMPORT_NO_LINK' using detail = 'atividade sem negócio, lead, pessoa ou organização importados';
  end if;

  if r.type = 'meeting' then
    select id into v_type from public.activity_types
     where company_id = r.company_id and is_meeting and active order by position, name limit 1;
  elsif r.type = 'task' then
    select id into v_type from public.activity_types
     where company_id = r.company_id and not is_meeting and active
     order by (public.import_norm(name) = 'tarefa') desc, position, name limit 1;
  else
    raise exception 'OXYN_IMPORT_INVALID' using detail = 'type';
  end if;
  if v_type is null then
    raise exception 'OXYN_IMPORT_NO_ACTIVITY_TYPE' using detail = r.type;
  end if;
  v_meeting := r.type = 'meeting';

  if coalesce(btrim(r.channel_name), '') <> '' then
    select id into v_channel from public.activity_channels
     where company_id = r.company_id and public.import_norm(name) = public.import_norm(r.channel_name)
     order by active desc, position limit 1;
  end if;
  if v_channel is null then
    select id into v_channel from public.activity_channels
     where company_id = r.company_id and is_legacy order by position limit 1;
  end if;
  if v_channel is null then
    raise exception 'OXYN_IMPORT_NO_LEGACY_CHANNEL';
  end if;

  v_created := coalesce(r.created_at, now());
  v_due := coalesce(r.due_at, v_created);
  v_done := coalesce(r.done, false);
  v_completed := case when v_done then coalesce(r.completed_at, v_due) end;
  v_subject := left(coalesce(nullif(btrim(r.subject), ''), '(sem assunto)'), 200);

  select o_id, o_stale into v_id, v_stale from public.import_state('activities', r.external_id, r.company_id);
  if v_stale then
    return 'skipped';
  end if;
  -- já concluída não troca tipo nem canal (guard_activity_completion): o resultado segue o tipo gravado
  if v_id is not null then
    select a.type_id, a.channel_id, t.is_meeting into v_old
      from public.activities a join public.activity_types t on t.id = a.type_id
     where a.id = v_id and a.done;
    if found then
      v_type := v_old.type_id;
      v_channel := v_old.channel_id;
      v_meeting := v_old.is_meeting;
    end if;
  end if;

  if v_done and v_meeting then
    v_meeting_outcome := r.meeting_outcome;
    if v_meeting_outcome is null then
      v_meeting_outcome := 'held';
      perform public.import_warn(p_job, 'activities', r.external_id,
        'reunião concluída sem resultado: gravada como realizada (held)');
    end if;
  elsif v_done then
    v_outcome := public.import_outcome(r.company_id);
  end if;

  if v_id is null then
    insert into public.activities (company_id, owner_id, type_id, channel_id, subject, description, due_at, done,
      completed_at, outcome_id, meeting_outcome, lead_id, deal_id, person_id, organization_id, legacy, created_at)
    values (r.company_id, r.owner_id, v_type, v_channel, v_subject, left(nullif(btrim(r.note), ''), 5000), v_due,
      v_done, v_completed, v_outcome, v_meeting_outcome, v_lead, v_deal, v_person, v_org, true, v_created)
    returning id into v_id;
    perform public.import_link(p_job, 'activities', r.external_id, r.company_id, v_id);
    return 'created';
  end if;
  v_before := public.import_snapshot('activities', v_id);
  begin
    update public.activities a
       set owner_id = r.owner_id, type_id = v_type, channel_id = v_channel,
           subject = v_subject, description = left(nullif(btrim(r.note), ''), 5000), due_at = v_due,
           done = v_done, completed_at = v_completed, outcome_id = v_outcome, meeting_outcome = v_meeting_outcome,
           lead_id = v_lead, deal_id = v_deal, person_id = v_person, organization_id = v_org,
           legacy = true, created_at = v_created
     where a.id = v_id;
    if public.import_snapshot('activities', v_id) = v_before then
      raise exception using errcode = 'OXNOP';
    end if;
  exception when sqlstate 'OXNOP' then
    return public.import_unchanged(p_job, 'activities', r.external_id, r.company_id);
  end;
  perform public.import_link(p_job, 'activities', r.external_id, r.company_id, v_id);
  return 'updated';
end $$;

-- 8. Anotações (corpo de 20261026000003) -------------------------------------------------------------------------------
-- Autor: author_id se for membro da empresa; senão quem criou o job, se for membro; senão erro de linha.
create or replace function public.import_upsert_notes(p_job uuid, p_row jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
  v_stale boolean;
  v_before jsonb;
  v_record uuid;
  v_body text;
  v_author uuid;
  v_job_author uuid;
  v_created timestamptz;
begin
  select * into r from jsonb_to_record(p_row) as x(external_id text, company_id uuid, entity text,
    record_external_id text, content text, author_id uuid, created_at timestamptz);
  perform public.import_required(r.external_id, 'external_id');
  if coalesce(r.entity, '') not in ('leads', 'persons', 'organizations', 'deals') then
    raise exception 'OXYN_IMPORT_INVALID' using detail = 'entity';
  end if;
  v_record := public.import_find(r.entity, r.record_external_id, r.company_id);
  if v_record is null then
    raise exception 'OXYN_IMPORT_NO_LINK' using detail = 'anotação sem registro importado';
  end if;
  v_body := left(public.import_required(r.content, 'content'), 10000);
  if r.author_id is not null and public.owner_has_membership(r.company_id, r.author_id) then
    v_author := r.author_id;
  else
    select created_by into v_job_author from public.import_jobs where id = p_job;
    if v_job_author is not null and public.owner_has_membership(r.company_id, v_job_author) then
      v_author := v_job_author;
    end if;
  end if;
  if v_author is null then
    raise exception 'OXYN_IMPORT_INVALID' using detail = 'author_id';
  end if;
  v_created := coalesce(r.created_at, now());

  select o_id, o_stale into v_id, v_stale from public.import_state('notes', r.external_id, r.company_id);
  if v_stale then
    return 'skipped';
  end if;
  if v_id is null then
    insert into public.notes (company_id, entity, record_id, body, created_by, created_at)
    values (r.company_id, r.entity, v_record, v_body, v_author, v_created)
    returning id into v_id;
    perform public.import_link(p_job, 'notes', r.external_id, r.company_id, v_id);
    return 'created';
  end if;
  v_before := public.import_snapshot('notes', v_id);
  begin
    update public.notes set body = v_body, created_by = v_author, created_at = v_created where id = v_id;
    if public.import_snapshot('notes', v_id) = v_before then
      raise exception using errcode = 'OXNOP';
    end if;
  exception when sqlstate 'OXNOP' then
    return public.import_unchanged(p_job, 'notes', r.external_id, r.company_id);
  end;
  perform public.import_link(p_job, 'notes', r.external_id, r.company_id, v_id);
  return 'updated';
end $$;

-- 9. Produtos (corpo de 20261026000003) --------------------------------------------------------------------------------
-- Só casa por external_id. Nome já usado por um produto do CRM é erro de linha (não sobrescreve).
create or replace function public.import_upsert_products(p_job uuid, p_row jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
  v_stale boolean;
  v_before jsonb;
  v_name text;
begin
  select * into r from jsonb_to_record(p_row) as x(external_id text, company_id uuid, name text, kind text, price numeric);
  perform public.import_required(r.external_id, 'external_id');
  v_name := left(public.import_required(r.name, 'name'), 120);

  select o_id, o_stale into v_id, v_stale from public.import_state('products', r.external_id, r.company_id);
  if v_stale then
    return 'skipped';
  end if;
  if exists (select 1 from public.products where company_id = r.company_id and name = v_name
             and id is distinct from v_id) then
    raise exception 'OXYN_IMPORT_DUPLICATE' using detail = 'name';
  end if;
  if v_id is null then
    insert into public.products (company_id, name, kind, default_price)
    values (r.company_id, v_name, r.kind, coalesce(r.price, 0))
    returning id into v_id;
    perform public.import_link(p_job, 'products', r.external_id, r.company_id, v_id);
    return 'created';
  end if;
  v_before := public.import_snapshot('products', v_id);
  begin
    update public.products set name = v_name, kind = r.kind, default_price = coalesce(r.price, 0) where id = v_id;
    if public.import_snapshot('products', v_id) = v_before then
      raise exception using errcode = 'OXNOP';
    end if;
  exception when sqlstate 'OXNOP' then
    return public.import_unchanged(p_job, 'products', r.external_id, r.company_id);
  end;
  perform public.import_link(p_job, 'products', r.external_id, r.company_id, v_id);
  return 'updated';
end $$;

-- 10. Reconstrução (corpo de 20261026000003): só o histórico inicial ---------------------------------------------------
-- O cronograma de receita já é regenerado pelo trigger deals_regenerate_schedule a cada insert/alteração do
-- contrato, inclusive sob o desvio; refazê-lo aqui era redundante.
create or replace function public.import_rebuild_deal_derivatives(p_job uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
begin
  if not exists (select 1 from public.import_jobs where id = p_job and status = 'running') then
    raise exception 'OXYN_IMPORT_NOT_RUNNING';
  end if;
  perform set_config('oxyn.importing', p_job::text, true);

  v_ids := array(
    select d.id from public.external_ids e join public.deals d on d.id = e.record_id and d.company_id = e.company_id
     where e.source = 'pipedrive' and e.entity = 'deals' and e.job_id = p_job);

  insert into public.deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_by, moved_at)
  select d.id, d.company_id, null, d.stage_id, null, d.stage_entered_at
    from public.deals d
   where d.id = any (v_ids)
     and not exists (select 1 from public.deal_stage_history h where h.deal_id = d.id);

  perform set_config('oxyn.importing', '', true);
  return cardinality(v_ids);
end $$;

-- 11. Permissões ------------------------------------------------------------------------------------------------------
drop function public.import_after_update(uuid, text, text, uuid, uuid, jsonb);
revoke execute on function
  public.import_owner(uuid, uuid),
  public.import_unchanged(uuid, text, text, uuid)
from public, anon, authenticated, service_role;
