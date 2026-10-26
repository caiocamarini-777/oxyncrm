-- Fase 3.5, rodada final de correções.
-- * import_custom_fields (corpo de 20261026000003): validação por chave; só as chaves inválidas são descartadas,
--   com um aviso por chave.
-- * import_upsert_deals (corpo de 20261026000004): na atualização, a referência do contrato usa
--   coalesce(r.won_at, d.won_at); seconds_in_previous nunca fica negativo.
-- * import_upsert_activities (corpo de 20261026000004): aceita duration_minutes (padrão 30).

-- 1. Campos personalizados ------------------------------------------------------------------------------------------
create or replace function public.import_custom_fields(p_job uuid, p_entity text, p_ext text, p_company uuid, p_cf jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_detail text;
  v_out jsonb := '{}';
  k text;
  v jsonb;
begin
  if p_cf is null or jsonb_typeof(p_cf) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_cf) <> 'object' then
    perform public.import_warn(p_job, p_entity, p_ext, 'campos personalizados descartados (formato inválido)');
    return null;
  end if;
  begin
    perform public.validate_custom_fields(p_company, p_entity, p_cf);
    return p_cf;
  exception when others then
    null;
  end;
  -- algum valor inválido: revalida chave a chave e descarta só as inválidas
  for k, v in select * from jsonb_each(p_cf) loop
    begin
      perform public.validate_custom_fields(p_company, p_entity, jsonb_build_object(k, v));
      v_out := v_out || jsonb_build_object(k, v);
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      perform public.import_warn(p_job, p_entity, p_ext,
        left('campo personalizado ' || k || ' descartado (' || sqlerrm
             || coalesce(': ' || nullif(v_detail, ''), '') || ')', 300));
    end;
  end loop;
  return v_out;
end $$;

-- 2. Negócios -------------------------------------------------------------------------------------------------------
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
  v_old_won timestamptz;
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
    v_old_won := (v_before->>'won_at')::timestamptz;
    -- o won_at gravado segue valendo quando a origem não traz um novo (won_at = coalesce(r.won_at, d.won_at))
    v_ref := date_trunc('month', coalesce(r.won_at, v_old_won, r.expected_close_date::timestamptz, v_created))::date;
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
              greatest(0, floor(extract(epoch from (v_new_entered - v_old_entered))))::int);
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

-- 3. Atividades -----------------------------------------------------------------------------------------------------
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
  v_duration int;
begin
  select * into r from jsonb_to_record(p_row) as x(external_id text, company_id uuid, owner_id uuid, type text,
    channel_name text, subject text, due_at timestamptz, done boolean, completed_at timestamptz,
    meeting_outcome text, note text, deal_external_id text, lead_external_id text, person_external_id text,
    organization_external_id text, created_at timestamptz, duration_minutes int);
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
  v_duration := case when r.duration_minutes between 0 and 1440 then r.duration_minutes else 30 end;

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
      completed_at, outcome_id, meeting_outcome, lead_id, deal_id, person_id, organization_id, legacy, created_at,
      duration_minutes)
    values (r.company_id, r.owner_id, v_type, v_channel, v_subject, left(nullif(btrim(r.note), ''), 5000), v_due,
      v_done, v_completed, v_outcome, v_meeting_outcome, v_lead, v_deal, v_person, v_org, true, v_created,
      v_duration)
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
           legacy = true, created_at = v_created, duration_minutes = v_duration
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
