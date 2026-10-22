-- Regras de negócio de negócios no banco: itens e totais, cronograma de receita, campos obrigatórios
-- por etapa, histórico de etapas, status, linha do tempo, conversão de lead, trava de status do lead,
-- filtros por etiqueta e busca (fase 3, tarefa 3).

-- Algoritmo do cronograma ------------------------------------------------------

create function public.build_revenue_schedule(
  p_setup numeric, p_installments int, p_setup_first date,
  p_mrr numeric, p_mrr_start date, p_months int)
returns table(month date, setup numeric, mrr numeric)
language sql immutable set search_path = public, pg_temp as $$
  with s as (
    select (date_trunc('month', p_setup_first::timestamp) + make_interval(months => i))::date as m,
      case when i < p_installments - 1 then trunc(p_setup / p_installments, 2)
           else p_setup - trunc(p_setup / p_installments, 2) * (p_installments - 1) end as amt
    from generate_series(0, greatest(coalesce(p_installments, 1), 1) - 1) i
    where coalesce(p_setup, 0) > 0 and p_setup_first is not null
  ), r as (
    select (date_trunc('month', p_mrr_start::timestamp) + make_interval(months => i))::date as m, p_mrr as amt
    from generate_series(0, coalesce(p_months, 0) - 1) i
    where coalesce(p_mrr, 0) > 0 and p_mrr_start is not null
  )
  select coalesce(s.m, r.m), coalesce(s.amt, 0), coalesce(r.amt, 0)
  from s full join r on s.m = r.m
  order by 1;
$$;
revoke execute on function public.build_revenue_schedule(numeric, int, date, numeric, date, int) from public, anon;
grant execute on function public.build_revenue_schedule(numeric, int, date, numeric, date, int) to authenticated;

create function public.deals_regenerate_schedule() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and
     (new.setup_total, new.setup_installments, new.setup_first_due, new.mrr, new.mrr_start, new.contract_months, new.deleted_at)
     is not distinct from
     (old.setup_total, old.setup_installments, old.setup_first_due, old.mrr, old.mrr_start, old.contract_months, old.deleted_at) then
    return new;
  end if;
  delete from public.deal_revenue_schedule where deal_id = new.id;
  if new.deleted_at is null then
    insert into public.deal_revenue_schedule (deal_id, company_id, month, setup, mrr)
    select new.id, new.company_id, b.month, b.setup, b.mrr
    from public.build_revenue_schedule(new.setup_total, new.setup_installments, new.setup_first_due,
                                       new.mrr, new.mrr_start, new.contract_months) b;
  end if;
  return new;
end $$;
create trigger deals_regenerate_schedule
  after insert or update of setup_total, setup_installments, setup_first_due, mrr, mrr_start, contract_months, deleted_at
  on public.deals for each row execute function public.deals_regenerate_schedule();

-- Itens e totais ---------------------------------------------------------------

create function public.deal_item_product_active() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not coalesce((select active from public.products where id = new.product_id), true) then
    raise exception 'OXYN_PRODUCT_INACTIVE';
  end if;
  return new;
end $$;
create trigger deal_item_product_active before insert on public.deal_items
  for each row execute function public.deal_item_product_active();

create function public.deal_items_recalc() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_deal uuid := case when tg_op = 'DELETE' then old.deal_id else new.deal_id end;
  v_setup numeric;
  v_mrr numeric;
  v_count bigint;
begin
  select coalesce(sum(total) filter (where kind = 'setup'), 0),
         coalesce(sum(total) filter (where kind = 'recurring'), 0), count(*)
    into v_setup, v_mrr, v_count
  from public.deal_items where deal_id = v_deal;
  if v_count > 0 then
    perform set_config('oxyn.items_recalc', 'on', true);
    update public.deals set setup_total = v_setup, mrr = v_mrr
      where id = v_deal and (setup_total, mrr) is distinct from (v_setup, v_mrr);
    perform set_config('oxyn.items_recalc', 'off', true);
  end if;
  return null;
end $$;
create trigger deal_items_recalc after insert or update or delete on public.deal_items
  for each row execute function public.deal_items_recalc();

create function public.deals_totals_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (new.setup_total is distinct from old.setup_total or new.mrr is distinct from old.mrr)
     and coalesce(current_setting('oxyn.items_recalc', true), '') <> 'on'
     and exists (select 1 from public.deal_items where deal_id = new.id) then
    raise exception 'OXYN_TOTALS_FROM_ITEMS';
  end if;
  return new;
end $$;
create trigger deals_totals_guard before update on public.deals
  for each row execute function public.deals_totals_guard();

-- Campos obrigatórios da etapa de destino ---------------------------------------------

create function public.deals_required_fields() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  req text[];
  k text;
  ok boolean;
  missing text[] := '{}';
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  select required_fields into req from public.stages where id = new.stage_id;
  if req is null or cardinality(req) = 0 then
    return new;
  end if;
  foreach k in array req loop
    if k = 'expected_close_date' then
      ok := new.expected_close_date is not null;
    elsif k = 'person_id' then
      ok := new.person_id is not null;
    elsif k = 'organization_id' then
      ok := new.organization_id is not null;
    elsif k = 'estimated_value' then
      ok := new.estimated_value is not null;
    elsif k = 'contract' then
      ok := (new.setup_total > 0 and new.setup_first_due is not null)
         or (new.mrr > 0 and new.mrr_start is not null and new.contract_months is not null);
    elsif k = 'products' then
      ok := tg_op = 'UPDATE' and exists (select 1 from public.deal_items where deal_id = new.id);
    elsif k like 'cf:%' then
      if not exists (select 1 from public.custom_field_defs
                     where company_id = new.company_id and entity = 'deals'
                       and key = substr(k, 4) and archived_at is null) then
        ok := true; -- campo arquivado (ou removido) não bloqueia
      else
        ok := coalesce(btrim(new.custom_fields ->> substr(k, 4)), '') not in ('', '[]');
      end if;
    else
      ok := true;
    end if;
    if not ok then
      missing := missing || k;
    end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'OXYN_REQUIRED_FIELDS' using detail = array_to_string(missing, ',');
  end if;
  return new;
end $$;
create trigger deals_required_fields before insert or update of stage_id on public.deals
  for each row execute function public.deals_required_fields();

-- Etapa e histórico ---------------------------------------------------------------------

create function public.deals_stage_entry() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := clock_timestamp();
  end if;
  return new;
end $$;
create trigger deals_stage_entry before update of stage_id on public.deals
  for each row execute function public.deals_stage_entry();

create function public.deals_stage_history() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_by)
    values (new.id, new.company_id, null, new.stage_id, auth.uid());
  elsif new.stage_id is distinct from old.stage_id then
    insert into public.deal_stage_history (deal_id, company_id, from_stage_id, to_stage_id, moved_by, seconds_in_previous)
    values (new.id, new.company_id, old.stage_id, new.stage_id, auth.uid(),
      floor(extract(epoch from (new.stage_entered_at - old.stage_entered_at)))::int);
  end if;
  return null;
end $$;
create trigger deals_stage_history after insert or update of stage_id on public.deals
  for each row execute function public.deals_stage_history();

-- Status ------------------------------------------------------------------------------------

create function public.deals_status_fields() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
  elsif new.status = 'open' then
    return new;
  end if;
  if new.status = 'won' then
    new.won_at := now(); new.lost_at := null; new.lost_reason_id := null; new.lost_note := null;
  elsif new.status = 'lost' then
    new.lost_at := now(); new.won_at := null;
  else
    new.won_at := null; new.lost_at := null; new.lost_reason_id := null; new.lost_note := null;
  end if;
  return new;
end $$;
create trigger deals_status_fields before insert or update of status on public.deals
  for each row execute function public.deals_status_fields();

-- Linha do tempo (estende a função da fase 2; leads e contatos mantêm o comportamento) ---------

create or replace function public.timeline_record_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ent text := tg_table_name;
  n jsonb := to_jsonb(new);
  o jsonb;
  changed text[];
  skip text[] := array['updated_at', 'deleted_at', 'owner_id', 'search_text'];
begin
  if tg_op = 'INSERT' then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id)
    values (new.company_id, ent, new.id, 'created', auth.uid());
    return new;
  end if;

  o := to_jsonb(old);
  if new.owner_id is distinct from old.owner_id then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
    values (new.company_id, ent, new.id, 'owner_changed', auth.uid(),
      jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if ent = 'leads' then
    skip := skip || array['converted_deal_id', 'converted_at'];
    if n->>'status' is distinct from o->>'status' then
      -- a conversão grava o próprio evento 'converted' em convert_lead
      if n->>'status' <> 'converted' then
        insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
        values (new.company_id, ent, new.id, 'status_changed', auth.uid(),
          jsonb_build_object('from', o->>'status', 'to', n->>'status', 'reason_id', n->'disqualification_reason_id'));
      end if;
      skip := skip || array['status', 'disqualification_reason_id'];
    end if;
  elsif ent = 'deals' then
    skip := skip || array['position', 'stage_entered_at', 'contract_value', 'won_at', 'lost_at'];
    if n->>'stage_id' is distinct from o->>'stage_id' then
      insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
      values (new.company_id, ent, new.id, 'stage_changed', auth.uid(),
        jsonb_build_object('from', o->>'stage_id', 'to', n->>'stage_id'));
      skip := skip || array['stage_id'];
    end if;
    if n->>'status' is distinct from o->>'status' then
      insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
      values (new.company_id, ent, new.id, 'status_changed', auth.uid(),
        jsonb_build_object('from', o->>'status', 'to', n->>'status', 'reason_id', n->'lost_reason_id'));
      skip := skip || array['status', 'lost_reason_id', 'lost_note'];
    end if;
    if coalesce(current_setting('oxyn.items_recalc', true), '') = 'on' then
      skip := skip || array['setup_total', 'mrr'];
    end if;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id)
    values (new.company_id, ent, new.id, case when new.deleted_at is null then 'restored' else 'trashed' end, auth.uid());
  end if;

  select array_agg(k order by k) into changed
  from jsonb_object_keys(n) k
  where n->k is distinct from o->k and not (k = any (skip));
  if changed is not null then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
    values (new.company_id, ent, new.id, 'updated', auth.uid(), jsonb_build_object('fields', to_jsonb(changed)));
  end if;
  return new;
end $$;

create trigger deals_timeline after insert or update on public.deals
  for each row execute function public.timeline_record_changes();

-- Leads: vínculo com o negócio e transições de status ----------------------------------------

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

create function public.guard_lead_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  converting boolean := coalesce(current_setting('oxyn.converting', true), '') = 'on';
begin
  if new.status is distinct from old.status then
    if not ((old.status = 'open' and new.status in ('disqualified', 'archived'))
         or (old.status in ('disqualified', 'archived') and new.status = 'open')
         or (old.status = 'open' and new.status = 'converted' and converting)) then
      raise exception 'OXYN_INVALID_TRANSITION';
    end if;
  end if;
  if (new.converted_deal_id is distinct from old.converted_deal_id
      or new.converted_at is distinct from old.converted_at) and not converting then
    -- única exceção: o FK zerando o vínculo quando o negócio foi apagado
    if not (new.converted_deal_id is null and old.converted_deal_id is not null
            and new.converted_at is not distinct from old.converted_at
            and not exists (select 1 from public.deals where id = old.converted_deal_id)) then
      raise exception 'OXYN_FORBIDDEN_FIELD';
    end if;
  end if;
  return new;
end $$;
create trigger guard_lead_status before update on public.leads
  for each row execute function public.guard_lead_status();

-- Conversão de lead em negócio ------------------------------------------------------------------

create function public.convert_lead(p_lead uuid, p_pipeline uuid, p_stage uuid, p_title text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.leads%rowtype;
  v_deal uuid;
begin
  if auth.uid() is null then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  select * into l from public.leads where id = p_lead for update;
  if not found then
    raise exception 'OXYN_NOT_FOUND';
  end if;
  if not public.can_access(l.company_id, 'leads', l.owner_id, 'edit')
     or not public.can_access(l.company_id, 'deals', l.owner_id, 'create') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;
  if l.deleted_at is not null or l.status <> 'open' then
    raise exception 'OXYN_INVALID_TRANSITION';
  end if;
  if not public.owner_has_membership(l.company_id, l.owner_id) then
    raise exception 'OXYN_OWNER_NOT_MEMBER';
  end if;

  insert into public.deals (company_id, owner_id, title, pipeline_id, stage_id, person_id, organization_id,
                            estimated_value, lead_id)
  values (l.company_id, l.owner_id, coalesce(nullif(btrim(p_title), ''), l.title), p_pipeline, p_stage,
          l.person_id, l.organization_id, l.estimated_value, l.id)
  returning id into v_deal;

  insert into public.record_labels (label_id, entity, record_id)
  select label_id, 'deals', v_deal from public.record_labels where entity = 'leads' and record_id = l.id;

  perform set_config('oxyn.converting', 'on', true);
  update public.leads set status = 'converted', converted_deal_id = v_deal, converted_at = now() where id = l.id;
  perform set_config('oxyn.converting', 'off', true);

  insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
  values (l.company_id, 'leads', l.id, 'converted', auth.uid(), jsonb_build_object('deal_id', v_deal));
  return v_deal;
end $$;
revoke execute on function public.convert_lead(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.convert_lead(uuid, uuid, uuid, text) to authenticated;

-- Filtros por etiqueta (security invoker: o RLS filtra) ------------------------------------------------

create function public.organizations_with_labels(p_label_ids uuid[]) returns setof public.organizations
language sql stable security invoker set search_path = public, pg_temp as $$
  select t.* from public.organizations t
  where not exists (
    select 1 from unnest(coalesce(p_label_ids, '{}')) x
    where not exists (select 1 from public.record_labels rl
                      where rl.entity = 'organizations' and rl.record_id = t.id and rl.label_id = x));
$$;
create function public.persons_with_labels(p_label_ids uuid[]) returns setof public.persons
language sql stable security invoker set search_path = public, pg_temp as $$
  select t.* from public.persons t
  where not exists (
    select 1 from unnest(coalesce(p_label_ids, '{}')) x
    where not exists (select 1 from public.record_labels rl
                      where rl.entity = 'persons' and rl.record_id = t.id and rl.label_id = x));
$$;
create function public.leads_with_labels(p_label_ids uuid[]) returns setof public.leads
language sql stable security invoker set search_path = public, pg_temp as $$
  select t.* from public.leads t
  where not exists (
    select 1 from unnest(coalesce(p_label_ids, '{}')) x
    where not exists (select 1 from public.record_labels rl
                      where rl.entity = 'leads' and rl.record_id = t.id and rl.label_id = x));
$$;
create function public.deals_with_labels(p_label_ids uuid[]) returns setof public.deals
language sql stable security invoker set search_path = public, pg_temp as $$
  select t.* from public.deals t
  where not exists (
    select 1 from unnest(coalesce(p_label_ids, '{}')) x
    where not exists (select 1 from public.record_labels rl
                      where rl.entity = 'deals' and rl.record_id = t.id and rl.label_id = x));
$$;
revoke execute on function public.organizations_with_labels(uuid[]), public.persons_with_labels(uuid[]),
  public.leads_with_labels(uuid[]), public.deals_with_labels(uuid[]) from public, anon;
grant execute on function public.organizations_with_labels(uuid[]), public.persons_with_labels(uuid[]),
  public.leads_with_labels(uuid[]), public.deals_with_labels(uuid[]) to authenticated;

-- Busca global com negócios ---------------------------------------------------------------------------

create or replace function public.global_search(p_query text, p_company uuid default null, p_limit int default 5)
returns table(entity text, record_id uuid, company_id uuid, title text, subtitle text)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  pat text;
begin
  if p_query is null or char_length(btrim(p_query)) < 2 then
    return;
  end if;
  pat := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  p_limit := least(greatest(coalesce(p_limit, 5), 1), 20);

  return query
    (select 'organizations'::text, o.id, o.company_id, o.name, coalesce(o.domain, o.cnpj)
     from public.organizations o
     where o.deleted_at is null and (p_company is null or o.company_id = p_company)
       and (lower(o.name) like lower(pat) escape '\' or o.cnpj ilike pat escape '\' or o.domain ilike pat escape '\')
     order by o.name limit p_limit)
    union all
    (select 'persons'::text, p.id, p.company_id, p.full_name, p.emails->0->>'value'
     from public.persons p
     where p.deleted_at is null and (p_company is null or p.company_id = p_company)
       and (lower(p.full_name) like lower(pat) escape '\'
         or exists (select 1 from jsonb_array_elements(p.emails) e where e->>'value' ilike pat escape '\'))
     order by p.full_name limit p_limit)
    union all
    (select 'leads'::text, l.id, l.company_id, l.title, l.status
     from public.leads l
     where l.deleted_at is null and (p_company is null or l.company_id = p_company)
       and lower(l.title) like lower(pat) escape '\'
     order by l.title limit p_limit)
    union all
    (select 'deals'::text, d.id, d.company_id, d.title, s.name
     from public.deals d
     join public.stages s on s.id = d.stage_id
     where d.deleted_at is null and (p_company is null or d.company_id = p_company)
       and lower(d.title) like lower(pat) escape '\'
     order by d.title limit p_limit);
end $$;

revoke execute on function
  public.deals_regenerate_schedule(), public.deal_item_product_active(), public.deal_items_recalc(),
  public.deals_totals_guard(), public.deals_required_fields(), public.deals_stage_entry(),
  public.deals_stage_history(), public.deals_status_fields(), public.guard_lead_status(),
  public.timeline_record_changes(), public.guard_same_company()
  from public, anon, authenticated;
