-- Fase 6: correções da revisão dos relatórios prontos (create or replace sobre os corpos da 000004).
-- 1. forecast ignora abertos sem expected_close_date (sem período, viravam uma linha de mês nulo).
-- 2. channel_funnel e conversion_influence aplicam a visibilidade do registro por trás de cada contagem:
--    escopo de leads para leads convertidos, escopo de negócios para ganhos e avanços de etapa.
-- 3. Reunião realizada criada no negócio depois da conversão (lead_id nulo) é atribuída ao lead do negócio
--    (coalesce(a.lead_id, d.lead_id)) nas etapas de realizadas e oportunidades do channel_funnel.
-- 4. Toda saída de run_report (custom e presets) ganha "truncated": true quando o limite de 500 linhas cortou o
--    resultado. As consultas buscam 501 linhas e report_cap_rows corta para 500.

-- Corta rows em 500 e marca truncated ------------------------------------------------------------------
create function public.report_cap_rows(p_result jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_array_length(p_result->'rows') > 500
    then jsonb_set(p_result, '{rows}', (select jsonb_agg(e order by i) from jsonb_array_elements(p_result->'rows')
           with ordinality t(e, i) where i <= 500)) || '{"truncated": true}'::jsonb
    else p_result || '{"truncated": false}'::jsonb end;
$$;
revoke execute on function public.report_cap_rows(jsonb) from public, anon, authenticated, service_role;


-- Execução da spec custom (corpo de run_report da Task 2). Recebe a spec já validada por run_report.
create or replace function public.run_report_custom(p_spec jsonb, p_companies uuid[], p_viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_base text;
  v_op text;
  v_group text;
  v_chart text;
  v_entity text;
  v_alias text;
  v_from text;
  v_where text;
  v_vis text;
  v_key text;
  v_custom uuid[];
  v_dim_label text;
  v_date_field text;
  v_date record;
  v_dim record;
  v_met record;
  v_fld record;
  v_lhs text;
  v_cast text;
  v_val text;
  v_clause text;
  v_k text;
  v_l text;
  v_j text := '';
  v_order text;
  v_inner text;
  v_total jsonb;
  v_rows jsonb;
  v_cols jsonb;
  f jsonb;
  i int := 0;
begin
  v_base := p_spec->>'base';
  v_op := p_spec->'metric'->>'op';
  v_group := nullif(p_spec->>'group_by', '');
  v_chart := p_spec->>'chart';
  v_entity := case v_base when 'leads' then 'leads' when 'activities' then 'activities' else 'deals' end;
  v_alias := case when v_base in ('revenue', 'stage_history') then 'd' else 'r' end;

  -- Visibilidade aplicada uma vez por linha da entidade base (revenue e stage_history: negócio dono),
  -- avaliando can_access_for uma vez por par (empresa, dono).
  v_vis := format(
    'select c.company_id, c.owner_id from (select distinct t.company_id, t.owner_id from public.%I t '
    'where t.company_id = any ($2) and t.deleted_at is null) c '
    'where public.can_access_for($3, c.company_id, %L, c.owner_id, ''read'')', v_entity, v_entity);
  v_from := case v_base
    when 'leads' then 'public.leads r'
    when 'deals' then 'public.deals r'
    when 'activities' then 'public.activities r'
    when 'revenue' then 'public.deal_revenue_schedule r join public.deals d on d.id = r.deal_id'
    when 'stage_history' then 'public.deal_stage_history r join public.deals d on d.id = r.deal_id'
  end || format(' join vis on vis.company_id = %1$s.company_id and vis.owner_id = %1$s.owner_id', v_alias);
  v_where := format('%1$s.deleted_at is null and %1$s.company_id = any ($2)', v_alias);
  if v_base = 'revenue' then
    v_where := v_where || ' and d.status <> ''lost''';
  end if;

  -- filtros: valores sempre lidos de $1 pelo índice do filtro
  for f in select x from jsonb_array_elements(coalesce(p_spec->'filters', '[]'::jsonb)) x loop
    select * into v_fld from public.report_field(v_base, f->>'field');
    v_cast := case v_fld.kind when 'text' then 'text' when 'num' then 'numeric'
      when 'ts' then 'date' when 'date' then 'date' else 'uuid' end;
    v_lhs := case when v_fld.kind = 'ts' then format('(%s at time zone ''America/Sao_Paulo'')::date', v_fld.expr)
      else v_fld.expr end;
    v_val := case f->>'op'
      when 'in' then format('array(select jsonb_array_elements_text($1->''filters''->%s->''value''))::%s[]', i, v_cast)
      when 'between' then format('($1->''filters''->%1$s->''value''->>0)::%2$s and ($1->''filters''->%1$s->''value''->>1)::%2$s', i, v_cast)
      else format('($1->''filters''->%s->>''value'')::%s', i, v_cast) end;
    if v_fld.kind = 'team' then
      v_clause := format('exists (select 1 from public.team_members tm where tm.user_id = %s and tm.team_id %s)',
        v_fld.expr, case f->>'op' when 'in' then '= any (' || v_val || ')' else '= ' || v_val end);
    elsif v_fld.kind = 'label' then
      v_clause := format('exists (select 1 from public.record_labels rl where rl.entity = %s and rl.record_id = r.id and rl.label_id %s)',
        v_fld.expr, case f->>'op' when 'in' then '= any (' || v_val || ')' else '= ' || v_val end);
    else
      v_clause := case f->>'op'
        when 'eq' then format('%s = %s', v_lhs, v_val)
        when 'in' then format('%s = any (%s)', v_lhs, v_val)
        when 'gte' then format('%s >= %s', v_lhs, v_val)
        when 'lte' then format('%s <= %s', v_lhs, v_val)
        when 'between' then format('%s between %s', v_lhs, v_val)
        when 'is_null' then format('%s is null', v_lhs)
        when 'not_null' then format('%s is not null', v_lhs) end;
    end if;
    v_where := v_where || ' and ' || v_clause;
    i := i + 1;
  end loop;

  -- período (datas inclusivas, pela data em São Paulo)
  if coalesce(jsonb_typeof(p_spec->'period'), 'null') = 'object' then
    v_date_field := p_spec->'period'->>'field';
    select * into v_date from public.report_field(v_base, v_date_field);
    v_where := v_where || format(' and %s between ($1#>>''{period,from}'')::date and ($1#>>''{period,to}'')::date',
      case when v_date.kind = 'ts' then format('(%s at time zone ''America/Sao_Paulo'')::date', v_date.expr)
           else v_date.expr end);
  else
    v_date_field := case v_base when 'activities' then 'due_at' when 'revenue' then 'month'
      when 'stage_history' then 'moved_at' else 'created_at' end;
    select * into v_date from public.report_field(v_base, v_date_field);
  end if;

  select * into v_met from public.report_metric(v_base, v_op, p_spec->'metric'->>'field');

  -- dimensão
  if v_group is null then
    null;
  elsif v_group = 'month' then
    v_k := case when v_date.kind = 'ts'
      then format('date_trunc(''month'', %s at time zone ''America/Sao_Paulo'')::date', v_date.expr)
      else format('date_trunc(''month'', %s::timestamp)::date', v_date.expr) end;
    v_l := format('to_char(%s, ''YYYY-MM-DD'')', v_k);
    v_dim_label := public.report_dimension_label('month');
  elsif v_group like 'custom:%' then
    -- só custom fields do tipo select, ativos, da entidade, em alguma das empresas pedidas;
    -- o valor só é lido nas empresas que têm o campo.
    v_key := substr(v_group, 8);
    select array_agg(cf.company_id), min(cf.label) into v_custom, v_dim_label
    from public.custom_field_defs cf
    where cf.company_id = any (p_companies) and cf.entity = v_base and cf.key = v_key
      and cf.type = 'select' and cf.archived_at is null;
    if v_custom is null and coalesce(cardinality(p_companies), 0) > 0 then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'group_by';
    end if;
    v_dim_label := coalesce(v_dim_label, v_key);
    v_k := format('coalesce(case when r.company_id = any ($4) then nullif(r.custom_fields->>%L, '''') end, ''Sem valor'')', v_key);
    v_l := v_k;
  else
    select * into v_dim from public.report_dimension(v_base, v_group);
    v_k := v_dim.k; v_l := v_dim.l; v_j := coalesce(' ' || v_dim.j, '');
    v_dim_label := public.report_dimension_label(v_group);
  end if;

  -- total, sem agrupamento
  v_inner := format('select %s as m, %s as n from %s where %s', v_met.m, v_met.n, v_from, v_where);
  execute format('with vis as materialized (%s) select to_jsonb(%s) from (%s) x', v_vis, v_met.agg, v_inner)
    into v_total using p_spec, p_companies, p_viewer, v_custom;
  v_total := coalesce(v_total, 'null'::jsonb);

  if v_group is null then
    v_rows := jsonb_build_array(jsonb_build_array(v_total));
  else
    v_order := case when v_group = 'month' then 'k' else 'v desc nulls last, l, k::text' end;
    v_inner := format('select %s as k, %s as l, %s as m, %s as n from %s%s where %s',
      v_k, v_l, v_met.m, v_met.n, v_from, v_j, v_where);
    execute format(
      'with vis as materialized (%s) '
      'select coalesce(jsonb_agg(jsonb_build_array(g.l, g.v) order by g.rn), ''[]''::jsonb) from ('
      '  select l, v, row_number() over (order by %s) as rn'
      '  from (select k, l, %s as v from (%s) x group by k, l) y'
      '  order by rn limit 501) g',
      v_vis, v_order, v_met.agg, v_inner)
      into v_rows using p_spec, p_companies, p_viewer, v_custom;
  end if;

  v_cols := case when v_group is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('key', v_group, 'label', v_dim_label,
      'type', case when v_group = 'month' then 'month' else 'text' end)) end
    || jsonb_build_array(jsonb_build_object('key', 'value', 'label', v_met.label, 'type', v_met.type));

  return public.report_cap_rows(jsonb_build_object('columns', v_cols, 'rows', v_rows,
    'total', case when v_chart = 'table' then null else v_total end));
end $$;

-- Presets ----------------------------------------------------------------------------------------------
-- Assinatura comum: p_params traz os params da spec mais "filters"; p_companies já vem recortado pelo
-- filtro company; p_from/p_to são o período (null = sem período). Saída {columns, rows, total}; total é null.
-- As consultas trazem até 501 linhas; run_report_preset corta em 500 e marca truncated.

-- Funil por canal (regras da fase 4). Só atividades concluídas, sem legadas e sem apagadas.
-- Tentativas e agendadas: atividades em leads (lead_id) que não são reunião, pelo channel_id, no completed_at.
-- Realizadas: reuniões held, pelo origin_channel_id, no completed_at da reunião. O lead é coalesce(a.lead_id,
--   deals.lead_id): reunião criada no negócio depois da conversão conta para o lead de origem.
-- Oportunidades: leads convertidos com reunião realizada, pelo origin_channel_id dela, uma vez por canal, no converted_at.
-- Ganhos: negócios ganhos desses leads (converted_deal_id), no won_at.
-- Visibilidade: atividades pelo escopo de atividades; o lead convertido pelo escopo de leads e o negócio ganho
--   pelo escopo de negócios (o viewer só conta registros que pode ver).
-- Crédito por canal: um lead com reuniões realizadas de canais diferentes conta em cada canal, então as linhas
--   não são somáveis (a soma de oportunidades ou ganhos entre canais pode passar do total de leads ou negócios).
create or replace function public.report_preset_channel_funnel(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('activities', p_companies, p_viewer, p_params->'filters')
  ), lv as materialized (
    -- só visibilidade: os filtros owner e team valem para a atividade, não para o dono do registro
    select * from public.report_preset_scope('leads', p_companies, p_viewer, '[]'::jsonb)
  ), dv as materialized (
    -- só visibilidade: os filtros owner e team valem para a atividade, não para o dono do registro
    select * from public.report_preset_scope('deals', p_companies, p_viewer, '[]'::jsonb)
  ), act as materialized (
    select a.id, a.lead_id as own_lead_id, coalesce(a.lead_id, dl.lead_id) as lead_id, a.channel_id, a.type_id,
      a.outcome_id, a.meeting_outcome, a.origin_channel_id, a.completed_at
    from public.activities a
    join vis on vis.company_id = a.company_id and vis.owner_id = a.owner_id
    left join public.deals dl on dl.id = a.deal_id
    where a.company_id = any (p_companies) and a.deleted_at is null and not a.legacy
      and a.done and coalesce(a.lead_id, dl.lead_id) is not null
  ), attempts as (
    select ch.name as channel, count(*) as attempts, count(*) filter (where o.books_meeting) as booked
    from act a
    join public.activity_types t on t.id = a.type_id
    join public.activity_channels ch on ch.id = a.channel_id
    left join public.activity_outcomes o on o.id = a.outcome_id
    where a.own_lead_id is not null and not t.is_meeting and public.report_in_period(a.completed_at, p_from, p_to)
    group by ch.name
  ), held as (
    select a.lead_id, ch.name as channel, a.completed_at
    from act a
    join public.activity_channels ch on ch.id = a.origin_channel_id
    where a.meeting_outcome = 'held'
  ), held_n as (
    select channel, count(*) as n from held
    where public.report_in_period(completed_at, p_from, p_to) group by channel
  ), conv as (
    select distinct h.channel, l.id as lead_id, l.converted_at, l.converted_deal_id
    from held h
    join public.leads l on l.id = h.lead_id
    join lv on lv.company_id = l.company_id and lv.owner_id = l.owner_id
    where l.status = 'converted' and l.deleted_at is null
  ), opp_n as (
    select channel, count(*) as n from conv
    where public.report_in_period(converted_at, p_from, p_to) group by channel
  ), won_n as (
    select c.channel, count(distinct d.id) as n
    from conv c
    join public.deals d on d.id = c.converted_deal_id
    join dv on dv.company_id = d.company_id and dv.owner_id = d.owner_id
    where d.status = 'won' and d.deleted_at is null and public.report_in_period(d.won_at, p_from, p_to)
    group by c.channel
  ), r as (
    select k.channel, coalesce(att.attempts, 0) as attempts, coalesce(att.booked, 0) as booked,
      coalesce(h.n, 0) as held, coalesce(o.n, 0) as opp, coalesce(w.n, 0) as won
    from (select channel from attempts union select channel from held_n
          union select channel from opp_n union select channel from won_n) k
    left join attempts att on att.channel = k.channel
    left join held_n h on h.channel = k.channel
    left join opp_n o on o.channel = k.channel
    left join won_n w on w.channel = k.channel
    order by 2 desc, 1
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('channel', 'Canal', 'text'),
      public.report_col('attempts', 'Tentativas', 'number'),
      public.report_col('meetings_booked', 'Reuniões agendadas', 'number'),
      public.report_col('meetings_held', 'Reuniões realizadas', 'number'),
      public.report_col('opportunities', 'Oportunidades', 'number'),
      public.report_col('won', 'Ganhos', 'number'),
      public.report_col('booked_rate', 'Taxa de agendamento', 'percent'),
      public.report_col('held_rate', 'Taxa de comparecimento', 'percent'),
      public.report_col('opportunity_rate', 'Taxa de oportunidade', 'percent'),
      public.report_col('won_rate', 'Taxa de ganho', 'percent')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.channel, r.attempts, r.booked, r.held, r.opp, r.won,
        public.report_rate(r.booked, r.attempts), public.report_rate(r.held, r.booked),
        public.report_rate(r.opp, r.held), public.report_rate(r.won, r.opp))
        order by r.attempts desc, r.channel) from r), '[]'::jsonb),
    'total', null);
$$;

-- Sucesso por canal: atividades concluídas (qualquer vínculo) por classificação do resultado, no completed_at.
-- Reuniões entram em "Sem resultado" (fecham com meeting_outcome, não com resultado).
create or replace function public.report_preset_channel_success(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('activities', p_companies, p_viewer, p_params->'filters')
  ), a as (
    select ch.name as channel, o.classification
    from public.activities a
    join vis on vis.company_id = a.company_id and vis.owner_id = a.owner_id
    join public.activity_channels ch on ch.id = a.channel_id
    left join public.activity_outcomes o on o.id = a.outcome_id
    where a.company_id = any (p_companies) and a.deleted_at is null and not a.legacy and a.done
      and public.report_in_period(a.completed_at, p_from, p_to)
  ), r as (
    select channel, count(*) as done,
      count(*) filter (where classification = 'success') as success,
      count(*) filter (where classification = 'neutral') as neutral,
      count(*) filter (where classification = 'failure') as failure,
      count(*) filter (where classification is null) as no_outcome
    from a group by channel
    order by 2 desc, 1
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('channel', 'Canal', 'text'),
      public.report_col('done', 'Concluídas', 'number'),
      public.report_col('success', 'Sucesso', 'number'),
      public.report_col('neutral', 'Neutro', 'number'),
      public.report_col('failure', 'Fracasso', 'number'),
      public.report_col('no_outcome', 'Sem resultado', 'number'),
      public.report_col('success_rate', 'Taxa de sucesso', 'percent')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.channel, r.done, r.success, r.neutral, r.failure,
        r.no_outcome, public.report_rate(r.success, r.done)) order by r.done desc, r.channel) from r), '[]'::jsonb),
    'total', null);
$$;

-- Influência na conversão: canal da última atividade concluída visível ao viewer antes de cada evento.
-- Eventos: lead convertido (atividades do lead, converted_at), avanço de etapa (etapa de posição maior no mesmo
-- funil, atividades do negócio, moved_at) e ganho (atividades do negócio, won_at). O período vale para o evento.
-- Evento sem atividade visível antes dele não entra. O registro do evento também precisa ser visível:
-- escopo de leads para a conversão, escopo de negócios para o avanço e o ganho.
create or replace function public.report_preset_conversion_influence(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('activities', p_companies, p_viewer, p_params->'filters')
  ), act as materialized (
    select a.id, a.lead_id, a.deal_id, a.channel_id, a.completed_at
    from public.activities a
    join vis on vis.company_id = a.company_id and vis.owner_id = a.owner_id
    where a.company_id = any (p_companies) and a.deleted_at is null and not a.legacy and a.done
  ), lv as materialized (
    -- só visibilidade: os filtros owner e team valem para a atividade, não para o dono do registro
    select * from public.report_preset_scope('leads', p_companies, p_viewer, '[]'::jsonb)
  ), dv as materialized (
    -- só visibilidade: os filtros owner e team valem para a atividade, não para o dono do registro
    select * from public.report_preset_scope('deals', p_companies, p_viewer, '[]'::jsonb)
  ), ev as (
    select 'conversion' as kind,
      (select x.channel_id from act x where x.lead_id = l.id and x.completed_at <= l.converted_at
       order by x.completed_at desc, x.id desc limit 1) as channel_id
    from public.leads l
    join lv on lv.company_id = l.company_id and lv.owner_id = l.owner_id
    where l.company_id = any (p_companies) and l.status = 'converted' and l.deleted_at is null
      and public.report_in_period(l.converted_at, p_from, p_to)
    union all
    select 'advance',
      (select x.channel_id from act x where x.deal_id = h.deal_id and x.completed_at <= h.moved_at
       order by x.completed_at desc, x.id desc limit 1)
    from public.deal_stage_history h
    join public.deals d on d.id = h.deal_id
    join dv on dv.company_id = d.company_id and dv.owner_id = d.owner_id
    join public.stages sf on sf.id = h.from_stage_id
    join public.stages st on st.id = h.to_stage_id
    where h.company_id = any (p_companies) and d.deleted_at is null
      and st.pipeline_id = sf.pipeline_id and st.position > sf.position
      and public.report_in_period(h.moved_at, p_from, p_to)
    union all
    select 'win',
      (select x.channel_id from act x where x.deal_id = d.id and x.completed_at <= d.won_at
       order by x.completed_at desc, x.id desc limit 1)
    from public.deals d
    join dv on dv.company_id = d.company_id and dv.owner_id = d.owner_id
    where d.company_id = any (p_companies) and d.status = 'won' and d.deleted_at is null
      and public.report_in_period(d.won_at, p_from, p_to)
  ), r as (
    select ch.name as channel,
      count(*) filter (where ev.kind = 'conversion') as conversions,
      count(*) filter (where ev.kind = 'advance') as advances,
      count(*) filter (where ev.kind = 'win') as wins
    from ev
    join public.activity_channels ch on ch.id = ev.channel_id
    group by ch.name
    order by 2 desc, 3 desc, 4 desc, 1
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('channel', 'Canal', 'text'),
      public.report_col('conversions', 'Leads convertidos', 'number'),
      public.report_col('stage_advances', 'Avanços de etapa', 'number'),
      public.report_col('wins', 'Ganhos', 'number')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.channel, r.conversions, r.advances, r.wins)
        order by r.conversions desc, r.advances desc, r.wins desc, r.channel) from r), '[]'::jsonb),
    'total', null);
$$;

-- Conversão por etapa de um funil (params.pipeline). Entradas pelo deal_stage_history (moved_at no período);
-- saída = o negócio foi depois para uma etapa de posição maior do funil, ou foi ganho parado na etapa.
-- Negócios distintos por etapa. Sem agrupamento: todas as etapas ativas, com zeros. Agrupado por owner (dono
-- atual do negócio) ou month (mês da entrada): só as combinações com entradas.
create or replace function public.report_preset_stage_conversion(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('deals', p_companies, p_viewer, p_params->'filters')
  ), st as (
    select s.id, s.name, s.position
    from public.stages s
    where s.pipeline_id = (p_params->>'pipeline')::uuid and s.company_id = any (p_companies)
      and s.archived_at is null and public.report_filter_ok(p_params->'filters', 'pipeline', s.pipeline_id)
  ), e as (
    select h.deal_id, h.to_stage_id as stage_id, h.moved_at, d.owner_id,
      (d.status = 'won' and d.stage_id = h.to_stage_id) or exists (
        select 1 from public.deal_stage_history h2
        join public.stages s2 on s2.id = h2.to_stage_id
        where h2.deal_id = h.deal_id and h2.from_stage_id = h.to_stage_id and h2.moved_at >= h.moved_at
          and s2.pipeline_id = (p_params->>'pipeline')::uuid and s2.position > st.position) as advanced
    from public.deal_stage_history h
    join st on st.id = h.to_stage_id
    join public.deals d on d.id = h.deal_id
    join vis on vis.company_id = d.company_id and vis.owner_id = d.owner_id
    where d.deleted_at is null and public.report_in_period(h.moved_at, p_from, p_to)
  ), g as (
    select case p_params->>'group_by'
        when 'owner' then e.owner_id::text
        when 'month' then to_char(public.report_month(e.moved_at), 'YYYY-MM-DD') end as gk,
      e.stage_id, count(distinct e.deal_id) as entered,
      count(distinct e.deal_id) filter (where e.advanced) as advanced
    from e group by 1, 2
  ), r as (
    select null::text as gk, null::text as gl, st.name, st.position,
      coalesce(g.entered, 0) as entered, coalesce(g.advanced, 0) as advanced
    from st left join g on g.stage_id = st.id
    where p_params->>'group_by' is null
    union all
    select g.gk, case when p_params->>'group_by' = 'owner' then public.report_user_label(g.gk::uuid) else g.gk end,
      st.name, st.position, g.entered, g.advanced
    from g join st on st.id = g.stage_id
    where p_params->>'group_by' is not null
  ), lim as (
    select * from r order by gl nulls first, gk nulls first, position limit 501
  )
  select jsonb_build_object(
    'columns', case p_params->>'group_by'
        when 'owner' then jsonb_build_array(public.report_col('owner', 'Responsável', 'text'))
        when 'month' then jsonb_build_array(public.report_col('month', 'Mês', 'month'))
        else '[]'::jsonb end
      || jsonb_build_array(
        public.report_col('stage', 'Etapa', 'text'),
        public.report_col('entered', 'Entraram', 'number'),
        public.report_col('advanced', 'Avançaram', 'number'),
        public.report_col('rate', 'Taxa de conversão', 'percent')),
    'rows', coalesce((select jsonb_agg(
        case when p_params->>'group_by' is null then '[]'::jsonb else jsonb_build_array(l.gl) end
        || jsonb_build_array(l.name, l.entered, l.advanced, public.report_rate(l.advanced, l.entered))
        order by l.gl nulls first, l.gk nulls first, l.position) from lim l), '[]'::jsonb),
    'total', null);
$$;

-- Forecast: abertos por mês de expected_close_date (quantidade e valor) e realizado (ganhos por mês de won_at).
create or replace function public.report_preset_forecast(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('deals', p_companies, p_viewer, p_params->'filters')
  ), d as (
    select d.status, d.expected_close_date, d.won_at, public.report_deal_value(d.contract_value, d.estimated_value) as value
    from public.deals d
    join vis on vis.company_id = d.company_id and vis.owner_id = d.owner_id
    where d.company_id = any (p_companies) and d.deleted_at is null
      and public.report_filter_ok(p_params->'filters', 'pipeline', d.pipeline_id)
  ), m as (
    select date_trunc('month', d.expected_close_date::timestamp)::date as month,
      1 as oc, d.value as ov, 0 as wc, 0::numeric as wv
    from d
    where d.status = 'open' and d.expected_close_date is not null
      and public.report_date_in_period(d.expected_close_date, p_from, p_to)
    union all
    select public.report_month(d.won_at), 0, 0, 1, d.value
    from d
    where d.status = 'won' and public.report_in_period(d.won_at, p_from, p_to)
  ), r as (
    select month, sum(oc) as oc, sum(ov) as ov, sum(wc) as wc, sum(wv) as wv
    from m group by month order by month limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('month', 'Mês', 'month'),
      public.report_col('open_count', 'Previstos', 'number'),
      public.report_col('open_value', 'Valor previsto', 'currency'),
      public.report_col('won_count', 'Ganhos', 'number'),
      public.report_col('won_value', 'Valor realizado', 'currency')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(to_char(r.month, 'YYYY-MM-DD'), r.oc, r.ov, r.wc, r.wv)
        order by r.month) from r), '[]'::jsonb),
    'total', null);
$$;

-- Receita mês a mês: contratada (cronograma dos ganhos) e prevista (cronograma dos abertos ponderado por
-- stages.probability / 100). Aberto sem cronograma entra pelo estimated_value ponderado, no mês de
-- expected_close_date, em coluna própria (o estimado não separa Setup de MRR). Perdidos ficam de fora.
create or replace function public.report_preset_revenue_monthly(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('deals', p_companies, p_viewer, p_params->'filters')
  ), d as (
    select d.id, d.status, d.estimated_value, d.expected_close_date, s.probability
    from public.deals d
    join vis on vis.company_id = d.company_id and vis.owner_id = d.owner_id
    join public.stages s on s.id = d.stage_id
    where d.company_id = any (p_companies) and d.deleted_at is null and d.status <> 'lost'
      and public.report_filter_ok(p_params->'filters', 'pipeline', d.pipeline_id)
  ), m as (
    select r.month,
      case when d.status = 'won' then r.setup else 0 end as sc,
      case when d.status = 'won' then r.mrr else 0 end as mc,
      case when d.status = 'open' then r.setup * d.probability / 100.0 else 0 end as sf,
      case when d.status = 'open' then r.mrr * d.probability / 100.0 else 0 end as mf,
      0::numeric as ef
    from public.deal_revenue_schedule r
    join d on d.id = r.deal_id
    where public.report_month_in_period(r.month, p_from, p_to)
    union all
    select date_trunc('month', d.expected_close_date::timestamp)::date, 0, 0, 0, 0,
      d.estimated_value * d.probability / 100.0
    from d
    where d.status = 'open' and d.expected_close_date is not null and coalesce(d.estimated_value, 0) > 0
      and not exists (select 1 from public.deal_revenue_schedule r where r.deal_id = d.id)
      and public.report_month_in_period(date_trunc('month', d.expected_close_date::timestamp)::date, p_from, p_to)
  ), r as (
    select month, sum(sc) as sc, sum(mc) as mc, round(sum(sf), 2) as sf, round(sum(mf), 2) as mf,
      round(sum(ef), 2) as ef
    from m group by month order by month limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('month', 'Mês', 'month'),
      public.report_col('setup_contracted', 'Setup contratado', 'currency'),
      public.report_col('mrr_contracted', 'MRR contratado', 'currency'),
      public.report_col('setup_forecast', 'Setup previsto', 'currency'),
      public.report_col('mrr_forecast', 'MRR previsto', 'currency'),
      public.report_col('estimated_forecast', 'Estimado previsto (sem cronograma)', 'currency')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(to_char(r.month, 'YYYY-MM-DD'), r.sc, r.mc, r.sf, r.mf, r.ef)
        order by r.month) from r), '[]'::jsonb),
    'total', null);
$$;

-- Visão do funil: abertos por funil e etapa (quantidade e valor). Retrato do momento: ignora o período.
-- Lista as etapas ativas de funis ativos com zeros, mais etapas arquivadas que ainda tenham abertos.
create or replace function public.report_preset_pipeline_overview(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('deals', p_companies, p_viewer, p_params->'filters')
  ), d as (
    select d.stage_id, public.report_deal_value(d.contract_value, d.estimated_value) as value
    from public.deals d
    join vis on vis.company_id = d.company_id and vis.owner_id = d.owner_id
    where d.company_id = any (p_companies) and d.deleted_at is null and d.status = 'open'
      and public.report_filter_ok(p_params->'filters', 'pipeline', d.pipeline_id)
  ), st as (
    select s.id, s.name, s.position, pl.id as pid, pl.name as pname, pl.position as ppos
    from public.stages s
    join public.pipelines pl on pl.id = s.pipeline_id
    where s.company_id = any (p_companies) and public.report_filter_ok(p_params->'filters', 'pipeline', pl.id)
      and ((s.archived_at is null and pl.archived_at is null) or s.id in (select stage_id from d))
  ), r as (
    select st.pname, st.name, st.ppos, st.pid, st.position, count(d.stage_id) as n, coalesce(sum(d.value), 0) as v
    from st left join d on d.stage_id = st.id
    group by st.id, st.name, st.position, st.pid, st.pname, st.ppos
    order by st.ppos, st.pname, st.pid, st.position
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('pipeline', 'Funil', 'text'),
      public.report_col('stage', 'Etapa', 'text'),
      public.report_col('count', 'Quantidade', 'number'),
      public.report_col('value', 'Valor', 'currency')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.pname, r.name, r.n, r.v)
        order by r.ppos, r.pname, r.pid, r.position) from r), '[]'::jsonb),
    'total', null);
$$;

-- Aging: leads abertos e negócios abertos, uma linha por registro (até 500), do mais antigo para o mais novo.
-- Retrato do momento: ignora o período. Com filtro de funil, os leads saem (não têm funil).
create or replace function public.report_preset_aging(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with lv as materialized (
    select * from public.report_preset_scope('leads', p_companies, p_viewer, p_params->'filters')
  ), dv as materialized (
    select * from public.report_preset_scope('deals', p_companies, p_viewer, p_params->'filters')
  ), x as (
    select 'Lead' as kind, l.id, l.title, l.owner_id, null::text as stage, l.created_at, null::timestamptz as entered
    from public.leads l
    join lv on lv.company_id = l.company_id and lv.owner_id = l.owner_id
    where l.company_id = any (p_companies) and l.deleted_at is null and l.status = 'open'
      and public.report_filter_ok(p_params->'filters', 'pipeline', null)
    union all
    select 'Negócio', d.id, d.title, d.owner_id, s.name, d.created_at, d.stage_entered_at
    from public.deals d
    join dv on dv.company_id = d.company_id and dv.owner_id = d.owner_id
    join public.stages s on s.id = d.stage_id
    where d.company_id = any (p_companies) and d.deleted_at is null and d.status = 'open'
      and public.report_filter_ok(p_params->'filters', 'pipeline', d.pipeline_id)
  ), r as (
    select kind, title, owner_id, stage,
      floor(extract(epoch from (now() - created_at)) / 86400)::int as age,
      floor(extract(epoch from (now() - entered)) / 86400)::int as in_stage,
      created_at, id
    from x
    order by created_at, title, id
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('type', 'Tipo', 'text'),
      public.report_col('title', 'Registro', 'text'),
      public.report_col('owner', 'Responsável', 'text'),
      public.report_col('stage', 'Etapa', 'text'),
      public.report_col('days_since_created', 'Dias desde a criação', 'days'),
      public.report_col('days_in_stage', 'Dias na etapa', 'days')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.kind, r.title, public.report_user_label(r.owner_id),
        r.stage, r.age, r.in_stage) order by r.created_at, r.title, r.id) from r), '[]'::jsonb),
    'total', null);
$$;

-- Atividades por usuário: concluídas no período (completed_at), atrasadas (abertas com due_at < now()) e
-- abertas. Atrasadas e abertas são retrato do momento. Sem legadas e sem apagadas.
create or replace function public.report_preset_activities_by_user(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('activities', p_companies, p_viewer, p_params->'filters')
  ), g as (
    select a.owner_id,
      count(*) filter (where a.done and public.report_in_period(a.completed_at, p_from, p_to)) as done,
      count(*) filter (where not a.done and a.due_at < now()) as overdue,
      count(*) filter (where not a.done) as open
    from public.activities a
    join vis on vis.company_id = a.company_id and vis.owner_id = a.owner_id
    where a.company_id = any (p_companies) and a.deleted_at is null and not a.legacy
    group by a.owner_id
  ), r as (
    select public.report_user_label(g.owner_id) as label, g.owner_id, g.done, g.overdue, g.open
    from g where g.done + g.open > 0
    order by g.done desc, 1, g.owner_id
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('owner', 'Responsável', 'text'),
      public.report_col('done', 'Concluídas', 'number'),
      public.report_col('overdue', 'Atrasadas', 'number'),
      public.report_col('open', 'Abertas', 'number')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.label, r.done, r.overdue, r.open)
        order by r.done desc, r.label, r.owner_id) from r), '[]'::jsonb),
    'total', null);
$$;

-- Motivos de perda: perdidos no período (lost_at), por nome do motivo, com quantidade e valor.
create or replace function public.report_preset_lost_reasons(p_params jsonb, p_companies uuid[], p_viewer uuid,
  p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with vis as materialized (
    select * from public.report_preset_scope('deals', p_companies, p_viewer, p_params->'filters')
  ), r as (
    select coalesce(lr.name, 'Sem motivo') as reason, count(*) as n,
      sum(public.report_deal_value(d.contract_value, d.estimated_value)) as v
    from public.deals d
    join vis on vis.company_id = d.company_id and vis.owner_id = d.owner_id
    left join public.lost_reasons lr on lr.id = d.lost_reason_id
    where d.company_id = any (p_companies) and d.deleted_at is null and d.status = 'lost'
      and public.report_filter_ok(p_params->'filters', 'pipeline', d.pipeline_id)
      and public.report_in_period(d.lost_at, p_from, p_to)
    group by 1
    order by 2 desc, 3 desc, 1
    limit 501
  )
  select jsonb_build_object(
    'columns', jsonb_build_array(
      public.report_col('lost_reason', 'Motivo de perda', 'text'),
      public.report_col('count', 'Quantidade', 'number'),
      public.report_col('value', 'Valor', 'currency')),
    'rows', coalesce((select jsonb_agg(jsonb_build_array(r.reason, r.n, r.v) order by r.n desc, r.v desc, r.reason)
        from r), '[]'::jsonb),
    'total', null);
$$;

-- Despacho -----------------------------------------------------------------------------------------------
-- Spec já validada. O filtro company recorta as empresas aqui; os demais filtros vão em p_params->'filters'.
create or replace function public.run_report_preset(p_spec jsonb, p_companies uuid[], p_viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_filters jsonb := case when jsonb_typeof(p_spec->'filters') = 'array' then p_spec->'filters' else '[]'::jsonb end;
  v_params jsonb;
  v_companies uuid[];
  v_from date := (p_spec#>>'{period,from}')::date;
  v_to date := (p_spec#>>'{period,to}')::date;
begin
  v_params := case when jsonb_typeof(p_spec->'params') = 'object' then p_spec->'params' else '{}'::jsonb end
    || jsonb_build_object('filters', v_filters);
  v_companies := array(select distinct c from unnest(coalesce(p_companies, '{}'::uuid[])) c
                       where c is not null and public.report_filter_ok(v_filters, 'company', c));
  case p_spec->>'kind'
    when 'channel_funnel' then
      return public.report_cap_rows(public.report_preset_channel_funnel(v_params, v_companies, p_viewer, v_from, v_to));
    when 'channel_success' then
      return public.report_cap_rows(public.report_preset_channel_success(v_params, v_companies, p_viewer, v_from, v_to));
    when 'conversion_influence' then
      return public.report_cap_rows(public.report_preset_conversion_influence(v_params, v_companies, p_viewer, v_from, v_to));
    when 'stage_conversion' then
      return public.report_cap_rows(public.report_preset_stage_conversion(v_params, v_companies, p_viewer, v_from, v_to));
    when 'forecast' then
      return public.report_cap_rows(public.report_preset_forecast(v_params, v_companies, p_viewer, v_from, v_to));
    when 'revenue_monthly' then
      return public.report_cap_rows(public.report_preset_revenue_monthly(v_params, v_companies, p_viewer, v_from, v_to));
    when 'pipeline_overview' then
      return public.report_cap_rows(public.report_preset_pipeline_overview(v_params, v_companies, p_viewer, v_from, v_to));
    when 'aging' then
      return public.report_cap_rows(public.report_preset_aging(v_params, v_companies, p_viewer, v_from, v_to));
    when 'activities_by_user' then
      return public.report_cap_rows(public.report_preset_activities_by_user(v_params, v_companies, p_viewer, v_from, v_to));
    when 'lost_reasons' then
      return public.report_cap_rows(public.report_preset_lost_reasons(v_params, v_companies, p_viewer, v_from, v_to));
    else
      raise exception 'OXYN_INVALID_REPORT' using detail = 'kind';
  end case;
end $$;
