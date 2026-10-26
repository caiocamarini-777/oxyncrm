-- Fase 3.5, task 2: funções de importação idempotentes por entidade e reconstrução dos derivados de negócios.
--
-- Contrato:
-- * import_upsert(job, entidade, linhas) é a única porta de entrada (service_role). Exige o job em 'running',
--   liga o desvio oxyn.importing (local à transação) e processa cada linha num subbloco: erro de uma linha vai
--   para o log do job (import_log_error) e o lote segue.
-- * Chave de idempotência: external_ids (source 'pipedrive', entidade, id externo, empresa). Vínculos entre
--   registros (person_external_id, deal_external_id...) são resolvidos sempre na MESMA empresa da linha.
--   Vínculo opcional ausente é descartado; contexto obrigatório ausente (atividade sem vínculo, anotação sem
--   registro) é erro de linha.
-- * Reimportação: só atualiza quando registro.updated_at = external_ids.record_updated_at (não foi editado no
--   CRM); senão conta em skipped. Depois de gravar, record_updated_at recebe o novo updated_at. Uma linha igual
--   à gravada conta em 'unchanged' (o UPDATE é feito e só depois comparado, sem updated_at).
-- * Avisos (campos personalizados descartados, contrato inválido, reunião concluída sem resultado) vão para o
--   log com o prefixo "aviso:" e contam em counters.<entidade>.warnings, não em errors.

-- 1. import_log_error (corpo de 20261026000002): "aviso:" conta em warnings ------------------------------------
create or replace function public.import_log_error(p_job uuid, p_entity text, p_external_id text, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_entity text := coalesce(p_entity, 'unknown');
  v_key text := case when coalesce(p_reason, '') like 'aviso:%' then 'warnings' else 'errors' end;
begin
  update public.import_jobs
     set errors = case when jsonb_array_length(errors) < 1000
                       then errors || jsonb_build_array(jsonb_build_object(
                              'entity', v_entity, 'external_id', p_external_id, 'reason', left(p_reason, 1000)))
                       else errors end,
         counters = jsonb_set(counters, array[v_entity],
           (case when jsonb_typeof(counters->v_entity) = 'object' then counters->v_entity else '{}'::jsonb end)
           || jsonb_build_object(v_key, coalesce((counters->v_entity->>v_key)::int, 0) + 1))
   where id = p_job;
end $$;
revoke execute on function public.import_log_error(uuid, text, text, text) from public, anon, authenticated, service_role;

-- 2. Auxiliares ---------------------------------------------------------------------------------------------------
-- Comparação de nomes sem caixa, sem acento e com espaços colapsados
create function public.import_norm(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select lower(regexp_replace(btrim(translate(coalesce(p, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '\s+', ' ', 'g'))
$$;

-- Lista de contatos: aceita strings ou objetos {value, label}; descarta vazios
create function public.import_contacts(p jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(
           case when jsonb_typeof(e) = 'string' then jsonb_build_object('value', btrim(e #>> '{}'))
                else jsonb_strip_nulls(jsonb_build_object('value', btrim(e->>'value'), 'label', e->>'label')) end
           order by o), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality t(e, o)
  where jsonb_typeof(e) in ('string', 'object')
    and coalesce(btrim(case when jsonb_typeof(e) = 'string' then e #>> '{}' else e->>'value' end), '') <> ''
$$;

-- Aviso no log do job
create function public.import_warn(p_job uuid, p_entity text, p_ext text, p_msg text) returns void
language sql security definer set search_path = public, pg_temp as $$
  select public.import_log_error(p_job, p_entity, p_ext, 'aviso: ' || p_msg)
$$;

-- Registro importado na empresa (null se não importado ou apagado). p_entity vem só das funções internas.
create function public.import_find(p_entity text, p_ext text, p_company uuid) returns uuid
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
  execute format('select id from public.%I where id = $1 and company_id = $2', p_entity) into v using v, p_company;
  return v;
end $$;

-- Estado do vínculo: o_id nulo = criar; o_stale = editado no CRM depois da última importação.
-- Vínculo para registro apagado definitivamente é removido (o registro é recriado).
create function public.import_state(p_entity text, p_ext text, p_company uuid, out o_id uuid, out o_stale boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rua timestamptz;
  v_cur timestamptz;
begin
  o_stale := false;
  select record_id, record_updated_at into o_id, v_rua from public.external_ids
   where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = p_company;
  if o_id is null then
    return;
  end if;
  execute format('select updated_at from public.%I where id = $1 and company_id = $2', p_entity)
    into v_cur using o_id, p_company;
  if v_cur is null then
    delete from public.external_ids
     where source = 'pipedrive' and entity = p_entity and external_id = p_ext and company_id = p_company;
    o_id := null;
    return;
  end if;
  o_stale := v_cur is distinct from v_rua;
end $$;

-- Grava/atualiza o vínculo com o carimbo do registro
create function public.import_link(p_job uuid, p_entity text, p_ext text, p_company uuid, p_record uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_upd timestamptz;
begin
  execute format('select updated_at from public.%I where id = $1', p_entity) into v_upd using p_record;
  insert into public.external_ids (source, entity, external_id, company_id, record_id, job_id, record_updated_at)
  values ('pipedrive', p_entity, p_ext, p_company, p_record, p_job, v_upd)
  on conflict (source, entity, external_id, company_id) do update
    set record_id = excluded.record_id, job_id = excluded.job_id,
        record_updated_at = excluded.record_updated_at, imported_at = now();
end $$;

-- Foto do registro para comparar antes/depois do UPDATE
create function public.import_snapshot(p_entity text, p_record uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
begin
  execute format('select to_jsonb(t) - ''updated_at'' from public.%I t where id = $1', p_entity) into v using p_record;
  return v;
end $$;

-- Fecha uma atualização: renova o vínculo e diz se algo mudou
create function public.import_after_update(p_job uuid, p_entity text, p_ext text, p_company uuid, p_record uuid,
  p_before jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.import_link(p_job, p_entity, p_ext, p_company, p_record);
  return case when public.import_snapshot(p_entity, p_record) = p_before then 'unchanged' else 'updated' end;
end $$;

-- Campos personalizados: valida; inválido vira aviso e null (a linha segue sem eles)
create function public.import_custom_fields(p_job uuid, p_entity text, p_ext text, p_company uuid, p_cf jsonb)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_detail text;
begin
  if p_cf is null or jsonb_typeof(p_cf) = 'null' then
    return null;
  end if;
  begin
    perform public.validate_custom_fields(p_company, p_entity, p_cf);
    return p_cf;
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    perform public.import_warn(p_job, p_entity, p_ext,
      left('campos personalizados descartados (' || sqlerrm || coalesce(': ' || nullif(v_detail, ''), '') || ')', 300));
    return null;
  end;
end $$;

-- Cadastro por nome na empresa (motivos de perda, origens de lead, etiquetas): reaproveita ou cria
create function public.import_named(p_table text, p_company uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'),
                      case when p_table = 'labels' then 40 else 80 end);
  v uuid;
begin
  if p_table not in ('lost_reasons', 'lead_sources', 'labels') then
    raise exception 'OXYN_IMPORT_INVALID_ENTITY';
  end if;
  if v_name = '' then
    return null;
  end if;
  execute format('select id from public.%I where company_id = $1 and public.import_norm(name) = public.import_norm($2)
                  order by (name = $2) desc, name limit 1', p_table) into v using p_company, v_name;
  if v is not null then
    return v;
  end if;
  if p_table = 'labels' then
    insert into public.labels (company_id, name, color) values (p_company, v_name, 'gray')
    on conflict (company_id, name) do nothing returning id into v;
  else
    execute format('insert into public.%I (company_id, name, position)
                    values ($1, $2, (select coalesce(max(position) + 1, 0) from public.%I where company_id = $1))
                    on conflict (company_id, name) do nothing returning id', p_table, p_table)
      into v using p_company, v_name;
  end if;
  if v is null then
    execute format('select id from public.%I where company_id = $1 and name = $2', p_table) into v using p_company, v_name;
  end if;
  return v;
end $$;

-- Resultado "Importado" da empresa: neutro e inativo (não aparece para escolha), criado uma vez
create function public.import_outcome(p_company uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v uuid;
begin
  select id into v from public.activity_outcomes where company_id = p_company and name = 'Importado';
  if v is null then
    insert into public.activity_outcomes (company_id, name, classification, books_meeting, position, active)
    values (p_company, 'Importado', 'neutral', false,
            (select coalesce(max(position) + 1, 0) from public.activity_outcomes where company_id = p_company), false)
    on conflict (company_id, name) do nothing returning id into v;
    if v is null then
      select id into v from public.activity_outcomes where company_id = p_company and name = 'Importado';
    end if;
  end if;
  return v;
end $$;

create function public.import_required(p_value text, p_field text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if coalesce(btrim(p_value), '') = '' then
    raise exception 'OXYN_IMPORT_REQUIRED' using detail = p_field;
  end if;
  return btrim(p_value);
end $$;

-- 3. Organizações ---------------------------------------------------------------------------------------------------
create function public.import_upsert_organizations(p_job uuid, p_row jsonb) returns text
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
  update public.organizations o
     set owner_id = r.owner_id, name = v_name, address = v_addr,
         custom_fields = o.custom_fields || coalesce(v_cf, '{}'), created_at = v_created
   where o.id = v_id;
  return public.import_after_update(p_job, 'organizations', r.external_id, r.company_id, v_id, v_before);
end $$;

-- 4. Pessoas ----------------------------------------------------------------------------------------------------------
create function public.import_upsert_persons(p_job uuid, p_row jsonb) returns text
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
  update public.persons p
     set owner_id = r.owner_id, full_name = v_name, emails = public.import_contacts(r.emails),
         phones = public.import_contacts(r.phones), organization_id = v_org,
         custom_fields = p.custom_fields || coalesce(v_cf, '{}'), created_at = v_created
   where p.id = v_id;
  return public.import_after_update(p_job, 'persons', r.external_id, r.company_id, v_id, v_before);
end $$;

-- 5. Leads --------------------------------------------------------------------------------------------------------------
create function public.import_upsert_leads(p_job uuid, p_row jsonb) returns text
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
    -- lead convertido (pela importação do negócio) ou desqualificado não volta a aberto/arquivado
    update public.leads l
       set owner_id = r.owner_id, title = v_title, estimated_value = r.value, person_id = v_person,
           organization_id = v_org, source_id = v_source,
           status = case when l.status in ('converted', 'disqualified') then l.status else v_status end,
           custom_fields = l.custom_fields || coalesce(v_cf, '{}'), created_at = v_created
     where l.id = v_id;
  end if;

  -- etiquetas: reaproveitadas pelo nome ou criadas; só acrescenta
  if jsonb_typeof(r.labels) = 'array' then
    for v_label in select e #>> '{}' from jsonb_array_elements(r.labels) e where jsonb_typeof(e) = 'string' loop
      v_label_id := public.import_named('labels', r.company_id, v_label);
      if v_label_id is not null then
        insert into public.record_labels (label_id, entity, record_id) values (v_label_id, 'leads', v_id)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  if v_result = 'created' then
    perform public.import_link(p_job, 'leads', r.external_id, r.company_id, v_id);
    return v_result;
  end if;
  return public.import_after_update(p_job, 'leads', r.external_id, r.company_id, v_id, v_before);
end $$;

-- 6. Negócios ------------------------------------------------------------------------------------------------------------
-- Contrato: MRR > 0 exige prazo (1..120); sem prazo grava mrr = 0 com aviso. mrr_start e setup_first_due
-- (dia 1) são o mês de won_at, senão de expected_close_date, senão de created_at; setup em 1 parcela.
create function public.import_upsert_deals(p_job uuid, p_row jsonb) returns text
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
    update public.deals d
       set owner_id = r.owner_id, pipeline_id = r.pipeline_id, stage_id = r.stage_id, title = v_title,
           status = v_status, estimated_value = r.value, setup_total = v_setup,
           setup_first_due = case when v_setup > 0 then coalesce(d.setup_first_due, v_ref) end,
           mrr = v_mrr, mrr_start = case when v_mrr > 0 then coalesce(d.mrr_start, v_ref) end,
           contract_months = v_months, expected_close_date = r.expected_close_date,
           won_at = coalesce(r.won_at, d.won_at), lost_at = coalesce(r.lost_at, d.lost_at), lost_reason_id = v_reason,
           stage_entered_at = coalesce(r.stage_entered_at, d.stage_entered_at),
           person_id = v_person, organization_id = v_org, lead_id = v_lead,
           custom_fields = d.custom_fields || coalesce(v_cf, '{}'), created_at = v_created
     where d.id = v_id;
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

  if v_result = 'created' then
    perform public.import_link(p_job, 'deals', r.external_id, r.company_id, v_id);
    return v_result;
  end if;
  return public.import_after_update(p_job, 'deals', r.external_id, r.company_id, v_id, v_before);
end $$;

-- 7. Atividades ----------------------------------------------------------------------------------------------------------
-- Tipo: 'meeting' = primeiro tipo de reunião ativo; 'task' = "Tarefa" ativo, senão o primeiro ativo que não é
-- reunião. Canal: pelo nome (sem caixa e sem acento); nulo ou desconhecido = canal legado (inativo).
-- Concluída: tarefa recebe o resultado "Importado"; reunião mantém meeting_outcome, e sem ele recebe 'held'
-- com aviso (a camada TS manda 'held' para reuniao_realizada concluída). Sempre legacy = true.
create function public.import_upsert_activities(p_job uuid, p_row jsonb) returns text
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
  update public.activities a
     set owner_id = r.owner_id, type_id = v_type, channel_id = v_channel,
         subject = v_subject, description = left(nullif(btrim(r.note), ''), 5000), due_at = v_due,
         done = v_done, completed_at = v_completed, outcome_id = v_outcome, meeting_outcome = v_meeting_outcome,
         lead_id = v_lead, deal_id = v_deal, person_id = v_person, organization_id = v_org,
         legacy = true, created_at = v_created
   where a.id = v_id;
  return public.import_after_update(p_job, 'activities', r.external_id, r.company_id, v_id, v_before);
end $$;

-- 8. Anotações --------------------------------------------------------------------------------------------------------
-- Autor: author_id, senão quem criou o job (notes.created_by é obrigatório). O registro não muda na reimportação.
create function public.import_upsert_notes(p_job uuid, p_row jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_id uuid;
  v_stale boolean;
  v_before jsonb;
  v_record uuid;
  v_body text;
  v_author uuid;
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
  v_author := coalesce(r.author_id, (select created_by from public.import_jobs where id = p_job));
  if v_author is null then
    raise exception 'OXYN_IMPORT_REQUIRED' using detail = 'author_id';
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
  update public.notes set body = v_body, created_by = v_author, created_at = v_created where id = v_id;
  return public.import_after_update(p_job, 'notes', r.external_id, r.company_id, v_id, v_before);
end $$;

-- 9. Produtos --------------------------------------------------------------------------------------------------------
-- Produto já cadastrado com o mesmo nome (único por empresa) é adotado pelo vínculo e atualizado.
create function public.import_upsert_products(p_job uuid, p_row jsonb) returns text
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
  if v_id is null then
    select id into v_id from public.products where company_id = r.company_id and name = v_name;
  end if;
  if v_id is null then
    insert into public.products (company_id, name, kind, default_price)
    values (r.company_id, v_name, r.kind, coalesce(r.price, 0))
    returning id into v_id;
    perform public.import_link(p_job, 'products', r.external_id, r.company_id, v_id);
    return 'created';
  end if;
  v_before := public.import_snapshot('products', v_id);
  update public.products set name = v_name, kind = r.kind, default_price = coalesce(r.price, 0) where id = v_id;
  return public.import_after_update(p_job, 'products', r.external_id, r.company_id, v_id, v_before);
end $$;

-- 10. Porta de entrada -------------------------------------------------------------------------------------------------
-- Devolve {created, updated, skipped, unchanged, errors}. Erros (e avisos) já entram em import_jobs.counters
-- via import_log_error; quem chama não deve somá-los de novo.
create function public.import_upsert(p_job uuid, p_entity text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row jsonb;
  v_res text;
  v_counts jsonb := '{"created": 0, "updated": 0, "skipped": 0, "unchanged": 0, "errors": 0}';
  v_detail text;
begin
  if not exists (select 1 from public.import_jobs where id = p_job and status = 'running') then
    raise exception 'OXYN_IMPORT_NOT_RUNNING';
  end if;
  if p_entity is null or p_entity not in ('organizations', 'persons', 'leads', 'deals', 'activities', 'notes', 'products') then
    raise exception 'OXYN_IMPORT_INVALID_ENTITY';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'OXYN_IMPORT_INVALID_ROWS';
  end if;

  perform set_config('oxyn.importing', p_job::text, true);
  for v_row in select e from jsonb_array_elements(p_rows) e loop
    begin
      if jsonb_typeof(v_row) <> 'object' then
        raise exception 'OXYN_IMPORT_INVALID_ROW';
      end if;
      execute format('select public.%I($1, $2)', 'import_upsert_' || p_entity) into v_res using p_job, v_row;
      v_counts := jsonb_set(v_counts, array[v_res], to_jsonb((v_counts->>v_res)::int + 1));
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      perform public.import_log_error(p_job, p_entity,
        case when jsonb_typeof(v_row) = 'object' then v_row->>'external_id' end,
        left(sqlerrm || coalesce(': ' || nullif(v_detail, ''), ''), 300));
      v_counts := jsonb_set(v_counts, '{errors}', to_jsonb((v_counts->>'errors')::int + 1));
    end;
  end loop;
  perform set_config('oxyn.importing', '', true);
  return v_counts;
end $$;

-- 11. Derivados dos negócios do job -------------------------------------------------------------------------------------
-- Histórico inicial de etapas (de nenhuma para a etapa atual, em stage_entered_at) quando o negócio não tem
-- nenhum, e cronograma de receita regenerado com build_revenue_schedule. Roda sob o desvio: sem timeline.
create function public.import_rebuild_deal_derivatives(p_job uuid) returns int
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

  delete from public.deal_revenue_schedule where deal_id = any (v_ids);
  insert into public.deal_revenue_schedule (deal_id, company_id, month, setup, mrr)
  select d.id, d.company_id, b.month, b.setup, b.mrr
    from public.deals d
   cross join lateral public.build_revenue_schedule(d.setup_total, d.setup_installments, d.setup_first_due,
                                                    d.mrr, d.mrr_start, d.contract_months) b
   where d.id = any (v_ids) and d.deleted_at is null;

  perform set_config('oxyn.importing', '', true);
  return cardinality(v_ids);
end $$;

-- 12. Permissões ------------------------------------------------------------------------------------------------------
revoke execute on function public.import_upsert(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_upsert(uuid, text, jsonb) to service_role;
revoke execute on function public.import_rebuild_deal_derivatives(uuid) from public, anon, authenticated;
grant execute on function public.import_rebuild_deal_derivatives(uuid) to service_role;

revoke execute on function
  public.import_norm(text),
  public.import_contacts(jsonb),
  public.import_warn(uuid, text, text, text),
  public.import_find(text, text, uuid),
  public.import_state(text, text, uuid),
  public.import_link(uuid, text, text, uuid, uuid),
  public.import_snapshot(text, uuid),
  public.import_after_update(uuid, text, text, uuid, uuid, jsonb),
  public.import_custom_fields(uuid, text, text, uuid, jsonb),
  public.import_named(text, uuid, text),
  public.import_outcome(uuid),
  public.import_required(text, text),
  public.import_upsert_organizations(uuid, jsonb),
  public.import_upsert_persons(uuid, jsonb),
  public.import_upsert_leads(uuid, jsonb),
  public.import_upsert_deals(uuid, jsonb),
  public.import_upsert_activities(uuid, jsonb),
  public.import_upsert_notes(uuid, jsonb),
  public.import_upsert_products(uuid, jsonb)
from public, anon, authenticated, service_role;
