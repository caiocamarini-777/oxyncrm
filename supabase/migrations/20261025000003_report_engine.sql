-- Fase 6: motor de relatórios personalizados.
-- Uma spec JSON controlada vira SQL seguro com a visibilidade do viewer. O SQL é montado com format()
-- só a partir dos mapas fixos abaixo (nome lógico -> expressão SQL); valores do usuário entram sempre
-- por parâmetro ($1 = spec, $2 = empresas, $3 = viewer, $4 = empresas com o custom field agrupado).
--
-- Aliases do SQL gerado: r = linha da base; d = negócio dono (bases revenue e stage_history).

-- Campos filtráveis, de período e somáveis --------------------------------------------------------
-- kind: uuid | text | ts (timestamptz, comparado pela data em São Paulo) | date | num
--       | team (dono pertence ao time) | label (registro tem a etiqueta; expr = entidade em record_labels)
create function public.report_field(p_base text, p_field text, out expr text, out kind text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  ow text := case when p_base in ('revenue', 'stage_history') then 'd.owner_id' else 'r.owner_id' end;
  co text := case when p_base in ('revenue', 'stage_history') then 'd.company_id' else 'r.company_id' end;
begin
  if p_base not in ('leads', 'deals', 'activities', 'revenue', 'stage_history') or p_field is null then
    return;
  end if;
  case p_field
    when 'owner' then expr := ow; kind := 'uuid';
    when 'company' then expr := co; kind := 'uuid';
    when 'team' then expr := ow; kind := 'team';
    else
      case p_base || ':' || p_field
        when 'leads:status' then expr := 'r.status'; kind := 'text';
        when 'leads:source' then expr := 'r.source_id'; kind := 'uuid';
        when 'leads:label' then expr := '''leads'''; kind := 'label';
        when 'leads:created_at' then expr := 'r.created_at'; kind := 'ts';
        when 'leads:converted_at' then expr := 'r.converted_at'; kind := 'ts';
        when 'leads:estimated_value' then expr := 'r.estimated_value'; kind := 'num';

        when 'deals:pipeline' then expr := 'r.pipeline_id'; kind := 'uuid';
        when 'deals:stage' then expr := 'r.stage_id'; kind := 'uuid';
        when 'deals:status' then expr := 'r.status'; kind := 'text';
        when 'deals:lost_reason' then expr := 'r.lost_reason_id'; kind := 'uuid';
        when 'deals:label' then expr := '''deals'''; kind := 'label';
        when 'deals:created_at' then expr := 'r.created_at'; kind := 'ts';
        when 'deals:won_at' then expr := 'r.won_at'; kind := 'ts';
        when 'deals:lost_at' then expr := 'r.lost_at'; kind := 'ts';
        when 'deals:expected_close_date' then expr := 'r.expected_close_date'; kind := 'date';
        when 'deals:contract_value' then expr := 'r.contract_value'; kind := 'num';
        when 'deals:setup_total' then expr := 'r.setup_total'; kind := 'num';
        when 'deals:mrr' then expr := 'r.mrr'; kind := 'num';
        when 'deals:estimated_value' then expr := 'r.estimated_value'; kind := 'num';

        when 'activities:type' then expr := 'r.type_id'; kind := 'uuid';
        when 'activities:channel' then expr := 'r.channel_id'; kind := 'uuid';
        when 'activities:outcome' then expr := 'r.outcome_id'; kind := 'uuid';
        when 'activities:outcome_classification' then
          expr := '(select ao.classification from public.activity_outcomes ao where ao.id = r.outcome_id)'; kind := 'text';
        when 'activities:meeting_outcome' then expr := 'r.meeting_outcome'; kind := 'text';
        when 'activities:due_at' then expr := 'r.due_at'; kind := 'ts';
        when 'activities:completed_at' then expr := 'r.completed_at'; kind := 'ts';

        when 'revenue:pipeline' then expr := 'd.pipeline_id'; kind := 'uuid';
        when 'revenue:deal_status' then expr := 'd.status'; kind := 'text';
        when 'revenue:month' then expr := 'r.month'; kind := 'date';
        when 'revenue:setup' then expr := 'r.setup'; kind := 'num';
        when 'revenue:mrr' then expr := 'r.mrr'; kind := 'num';
        when 'revenue:total' then expr := '(r.setup + r.mrr)'; kind := 'num';

        -- funil da etapa de destino (o negócio pode ter mudado de funil depois)
        when 'stage_history:pipeline' then
          expr := '(select s.pipeline_id from public.stages s where s.id = r.to_stage_id)'; kind := 'uuid';
        when 'stage_history:from_stage' then expr := 'r.from_stage_id'; kind := 'uuid';
        when 'stage_history:to_stage' then expr := 'r.to_stage_id'; kind := 'uuid';
        when 'stage_history:moved_at' then expr := 'r.moved_at'; kind := 'ts';
        else null;
      end case;
  end case;
end $$;

-- Dimensões de agrupamento: k = chave do grupo, l = rótulo exibido, j = join extra --------------------
-- "month" e "custom:<key>" são tratados em run_report.
create function public.report_dimension(p_base text, p_dim text, out k text, out l text, out j text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  ow text := case when p_base in ('revenue', 'stage_history') then 'd.owner_id' else 'r.owner_id' end;
  co text := case when p_base in ('revenue', 'stage_history') then 'd.company_id' else 'r.company_id' end;
  deal_status text := 'case %s when ''open'' then ''Aberto'' when ''won'' then ''Ganho'' when ''lost'' then ''Perdido'' end';
begin
  case p_base || ':' || coalesce(p_dim, '')
    when 'leads:owner', 'deals:owner', 'activities:owner', 'revenue:owner', 'stage_history:owner' then
      k := ow;
      l := format('(select coalesce(nullif(p.full_name, ''''), p.email) from public.profiles p where p.id = %s)', ow);
    -- Equipe pelos team_members do dono. Dono em vários times: a linha conta em cada time
    -- (soma das linhas pode passar do total). Dono sem time vai para "Sem equipe".
    when 'leads:team', 'deals:team', 'activities:team' then
      j := format('left join lateral (select t.id, t.name from public.team_members tm '
                  'join public.teams t on t.id = tm.team_id where tm.user_id = %s) dt on true', ow);
      k := 'dt.id';
      l := 'coalesce(dt.name, ''Sem equipe'')';
    when 'leads:company', 'deals:company', 'activities:company', 'revenue:company' then
      k := co;
      l := format('(select c.name from public.companies c where c.id = %s)', co);
    when 'leads:status' then
      k := 'r.status';
      l := 'case r.status when ''open'' then ''Aberto'' when ''converted'' then ''Convertido'' '
           'when ''disqualified'' then ''Desqualificado'' when ''archived'' then ''Arquivado'' end';
    when 'deals:status' then
      k := 'r.status'; l := format(deal_status, 'r.status');
    when 'revenue:deal_status' then
      k := 'd.status'; l := format(deal_status, 'd.status');
    when 'leads:source' then
      k := 'r.source_id';
      l := 'coalesce((select s.name from public.lead_sources s where s.id = r.source_id), ''Sem origem'')';
    -- Etiqueta: registro com várias etiquetas conta em cada; sem etiqueta vai para "Sem etiqueta".
    when 'leads:label', 'deals:label' then
      j := format('left join lateral (select lb.id, lb.name from public.record_labels rl '
                  'join public.labels lb on lb.id = rl.label_id '
                  'where rl.entity = %L and rl.record_id = r.id) dl on true', p_base);
      k := 'dl.id';
      l := 'coalesce(dl.name, ''Sem etiqueta'')';
    when 'deals:pipeline', 'revenue:pipeline', 'stage_history:pipeline' then
      k := case p_base when 'deals' then 'r.pipeline_id' when 'revenue' then 'd.pipeline_id'
           else '(select s.pipeline_id from public.stages s where s.id = r.to_stage_id)' end;
      l := format('(select pl.name from public.pipelines pl where pl.id = %s)', k);
    when 'deals:stage' then
      k := 'r.stage_id';
      l := '(select s.name from public.stages s where s.id = r.stage_id)';
    when 'deals:lost_reason' then
      k := 'r.lost_reason_id';
      l := 'coalesce((select lr.name from public.lost_reasons lr where lr.id = r.lost_reason_id), ''Sem motivo'')';
    when 'activities:type' then
      k := 'r.type_id';
      l := '(select t.name from public.activity_types t where t.id = r.type_id)';
    when 'activities:channel' then
      k := 'r.channel_id';
      l := '(select ch.name from public.activity_channels ch where ch.id = r.channel_id)';
    when 'activities:outcome' then
      k := 'r.outcome_id';
      l := 'coalesce((select ao.name from public.activity_outcomes ao where ao.id = r.outcome_id), ''Sem resultado'')';
    when 'activities:outcome_classification' then
      k := '(select ao.classification from public.activity_outcomes ao where ao.id = r.outcome_id)';
      l := format('coalesce(case %s when ''success'' then ''Sucesso'' when ''neutral'' then ''Neutro'' '
                  'when ''failure'' then ''Fracasso'' end, ''Sem resultado'')', k);
    when 'activities:meeting_outcome' then
      k := 'r.meeting_outcome';
      l := 'coalesce(case r.meeting_outcome when ''held'' then ''Realizada'' when ''no_show'' then ''Não compareceu'' '
           'when ''rescheduled'' then ''Reagendada'' when ''canceled'' then ''Cancelada'' end, ''Sem resultado'')';
    when 'stage_history:from_stage' then
      k := 'r.from_stage_id';
      l := 'coalesce((select s.name from public.stages s where s.id = r.from_stage_id), ''Sem etapa anterior'')';
    when 'stage_history:to_stage' then
      k := 'r.to_stage_id';
      l := '(select s.name from public.stages s where s.id = r.to_stage_id)';
    else
      null;
  end case;
end $$;

create function public.report_dimension_label(p_dim text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_dim
    when 'owner' then 'Responsável' when 'team' then 'Equipe' when 'company' then 'Empresa'
    when 'status' then 'Status' when 'source' then 'Origem' when 'label' then 'Etiqueta'
    when 'month' then 'Mês' when 'pipeline' then 'Funil' when 'stage' then 'Etapa'
    when 'lost_reason' then 'Motivo de perda' when 'type' then 'Tipo' when 'channel' then 'Canal'
    when 'outcome' then 'Resultado' when 'outcome_classification' then 'Classificação do resultado'
    when 'meeting_outcome' then 'Resultado da reunião' when 'deal_status' then 'Status do negócio'
    when 'from_stage' then 'Etapa de origem' when 'to_stage' then 'Etapa de destino'
  end;
$$;

create function public.report_field_label(p_field text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_field
    when 'estimated_value' then 'Valor estimado' when 'contract_value' then 'Valor do contrato'
    when 'setup_total' then 'Setup' when 'mrr' then 'MRR' when 'setup' then 'Setup' when 'total' then 'Total'
  end;
$$;

-- Métrica: m e n são as entradas por linha; agg agrega sobre elas -------------------------------------
create function public.report_metric(p_base text, p_op text, p_field text,
  out m text, out n text, out agg text, out label text, out type text)
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  m := 'null::numeric'; n := 'null::numeric';
  case p_op
    when 'count' then
      agg := 'count(*)'; label := 'Quantidade'; type := 'number';
    when 'sum' then
      m := (public.report_field(p_base, p_field)).expr;
      agg := 'coalesce(sum(m), 0)'; label := 'Soma de ' || public.report_field_label(p_field); type := 'currency';
    when 'avg' then
      m := (public.report_field(p_base, p_field)).expr;
      agg := 'round(avg(m), 2)'; label := 'Média de ' || public.report_field_label(p_field); type := 'currency';
    when 'conversion_rate' then
      -- leads: convertidos / total; deals: ganhos / (ganhos + perdidos). 0 quando o denominador é 0.
      if p_base = 'leads' then
        m := 'case when r.status = ''converted'' then 1 else 0 end'; n := '1';
      else
        m := 'case when r.status = ''won'' then 1 else 0 end';
        n := 'case when r.status in (''won'', ''lost'') then 1 else 0 end';
      end if;
      agg := 'coalesce(round(100.0 * sum(m) / nullif(sum(n), 0), 1), 0)'; label := 'Taxa de conversão'; type := 'percent';
    when 'avg_days' then
      m := case p_base
        when 'leads' then 'extract(epoch from (r.converted_at - r.created_at)) / 86400.0'
        when 'deals' then 'extract(epoch from (r.won_at - r.created_at)) / 86400.0'
        else 'r.seconds_in_previous / 86400.0' end;
      agg := 'round(avg(m), 1)'; label := 'Média de dias'; type := 'days';
    else
      null;
  end case;
end $$;

-- Validação ------------------------------------------------------------------------------------------
create function public.report_valid_date(p_value jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_value) is distinct from 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  return to_char((p_value #>> '{}')::date, 'YYYY-MM-DD') = (p_value #>> '{}');
exception when others then
  return false;
end $$;

create function public.report_valid_scalar(p_kind text, p_value jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(case
    when p_kind in ('uuid', 'team', 'label') then jsonb_typeof(p_value) = 'string'
      and (p_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    when p_kind = 'text' then jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') <= 200
    when p_kind in ('ts', 'date') then public.report_valid_date(p_value)
    when p_kind = 'num' then jsonb_typeof(p_value) = 'number'
  end, false);
$$;

create function public.validate_report_spec(p_spec jsonb) returns void
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_base text;
  v_op text;
  v_field text;
  v_group text;
  v_kind text;
  f jsonb;
  v jsonb;
  e jsonb;
  reason text;
begin
  reason := case
    when p_spec is null or jsonb_typeof(p_spec) <> 'object' then 'spec'
    when exists (select 1 from jsonb_object_keys(p_spec) x
                 where x not in ('kind', 'base', 'metric', 'group_by', 'filters', 'period', 'chart')) then 'keys'
    when p_spec->'kind' is distinct from '"custom"'::jsonb then 'kind'
    when jsonb_typeof(p_spec->'base') is distinct from 'string'
      or p_spec->>'base' not in ('leads', 'deals', 'activities', 'revenue', 'stage_history') then 'base'
    when jsonb_typeof(p_spec->'chart') is distinct from 'string'
      or p_spec->>'chart' not in ('number', 'bar', 'line', 'funnel', 'pie', 'table') then 'chart'
    when jsonb_typeof(p_spec->'metric') is distinct from 'object'
      or exists (select 1 from jsonb_object_keys(p_spec->'metric') x where x not in ('op', 'field')) then 'metric'
    when jsonb_typeof(p_spec->'metric'->'op') is distinct from 'string'
      or p_spec->'metric'->>'op' not in ('count', 'sum', 'avg', 'conversion_rate', 'avg_days') then 'metric.op'
    when coalesce(jsonb_typeof(p_spec->'metric'->'field'), 'null') not in ('null', 'string') then 'metric.field'
    when coalesce(jsonb_typeof(p_spec->'group_by'), 'null') not in ('null', 'string') then 'group_by'
    when coalesce(jsonb_typeof(p_spec->'filters'), 'null') not in ('null', 'array') then 'filters'
    when coalesce(jsonb_typeof(p_spec->'period'), 'null') not in ('null', 'object') then 'period'
  end;
  if reason is not null then
    raise exception 'OXYN_INVALID_REPORT' using detail = reason;
  end if;

  v_base := p_spec->>'base';
  v_op := p_spec->'metric'->>'op';
  v_field := p_spec->'metric'->>'field';
  v_group := p_spec->>'group_by';

  -- métrica
  reason := case v_op
    when 'count' then case when v_field is not null then 'metric.field' end
    when 'sum' then case when (public.report_field(v_base, v_field)).kind is distinct from 'num' then 'metric.field' end
    when 'avg' then case when (public.report_field(v_base, v_field)).kind is distinct from 'num' then 'metric.field' end
    when 'conversion_rate' then case when v_base not in ('leads', 'deals') or v_field is not null then 'metric.op' end
    when 'avg_days' then case when v_base not in ('leads', 'deals', 'stage_history') or v_field is not null then 'metric.op' end
  end;
  if reason is not null then
    raise exception 'OXYN_INVALID_REPORT' using detail = reason;
  end if;

  -- agrupamento
  if v_group is not null then
    if v_group like 'custom:%' then
      if v_base not in ('leads', 'deals') or substr(v_group, 8) !~ '^[a-z][a-z0-9_]{0,39}$' then
        raise exception 'OXYN_INVALID_REPORT' using detail = 'group_by';
      end if;
    elsif v_group <> 'month' and (public.report_dimension(v_base, v_group)).k is null then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'group_by';
    end if;
  end if;

  -- filtros
  if jsonb_array_length(coalesce(p_spec->'filters', '[]'::jsonb)) > 20 then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
  end if;
  for f in select x from jsonb_array_elements(coalesce(p_spec->'filters', '[]'::jsonb)) x loop
    if jsonb_typeof(f) <> 'object'
       or exists (select 1 from jsonb_object_keys(f) x where x not in ('field', 'op', 'value'))
       or jsonb_typeof(f->'field') is distinct from 'string'
       or jsonb_typeof(f->'op') is distinct from 'string' then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filter';
    end if;
    v_kind := (public.report_field(v_base, f->>'field')).kind;
    v := f->'value';
    if v_kind is null then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filter.field';
    end if;
    if not (f->>'op' = any (case
         when v_kind in ('uuid', 'text') then array['eq', 'in', 'is_null', 'not_null']
         when v_kind in ('team', 'label') then array['eq', 'in']
         else array['eq', 'gte', 'lte', 'between', 'is_null', 'not_null'] end)) then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filter.op';
    end if;
    reason := null;
    case f->>'op'
      when 'eq', 'gte', 'lte' then
        if not public.report_valid_scalar(v_kind, v) then reason := 'filter.value'; end if;
      when 'in' then
        if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) not between 1 and 500 then
          reason := 'filter.value';
        else
          for e in select x from jsonb_array_elements(v) x loop
            if not public.report_valid_scalar(v_kind, e) then reason := 'filter.value'; exit; end if;
          end loop;
        end if;
      when 'between' then
        if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) <> 2
           or not public.report_valid_scalar(v_kind, v->0) or not public.report_valid_scalar(v_kind, v->1) then
          reason := 'filter.value';
        elsif (v_kind = 'num' and (v->>0)::numeric > (v->>1)::numeric)
           or (v_kind <> 'num' and (v->>0)::date > (v->>1)::date) then
          reason := 'filter.value';
        end if;
      when 'is_null', 'not_null' then
        if coalesce(jsonb_typeof(v), 'null') <> 'null' then reason := 'filter.value'; end if;
    end case;
    if reason is not null then
      raise exception 'OXYN_INVALID_REPORT' using detail = reason;
    end if;
  end loop;

  -- período
  if coalesce(jsonb_typeof(p_spec->'period'), 'null') = 'object' then
    f := p_spec->'period';
    if exists (select 1 from jsonb_object_keys(f) x where x not in ('field', 'from', 'to'))
       or jsonb_typeof(f->'field') is distinct from 'string'
       or (public.report_field(v_base, f->>'field')).kind is distinct from 'ts'
          and (public.report_field(v_base, f->>'field')).kind is distinct from 'date'
       or not public.report_valid_date(f->'from') or not public.report_valid_date(f->'to')
       or (f->>'from')::date > (f->>'to')::date then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'period';
    end if;
  end if;
end $$;

-- Execução -------------------------------------------------------------------------------------------
create function public.run_report(p_spec jsonb, p_companies uuid[], p_viewer uuid) returns jsonb
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
  perform public.validate_report_spec(p_spec);

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
      '  order by rn limit 500) g',
      v_vis, v_order, v_met.agg, v_inner)
      into v_rows using p_spec, p_companies, p_viewer, v_custom;
  end if;

  v_cols := case when v_group is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('key', v_group, 'label', v_dim_label,
      'type', case when v_group = 'month' then 'month' else 'text' end)) end
    || jsonb_build_array(jsonb_build_object('key', 'value', 'label', v_met.label, 'type', v_met.type));

  return jsonb_build_object('columns', v_cols, 'rows', v_rows,
    'total', case when v_chart = 'table' then null else v_total end);
end $$;

-- Entrada do cliente: viewer = auth.uid(), com acesso e view_reports em todas as empresas pedidas.
create function public.run_report_self(p_spec jsonb, p_companies uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  c uuid;
begin
  if not public.current_user_active() then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  foreach c in array coalesce(p_companies, '{}'::uuid[]) loop
    if c is null or not public.has_company_access(c) or not public.has_report_setting(c, 'view_reports') then
      raise exception 'OXYN_FORBIDDEN';
    end if;
  end loop;
  return public.run_report(p_spec, p_companies, auth.uid());
end $$;

revoke execute on function public.report_field(text, text), public.report_dimension(text, text),
  public.report_dimension_label(text), public.report_field_label(text),
  public.report_metric(text, text, text), public.report_valid_date(jsonb), public.report_valid_scalar(text, jsonb),
  public.validate_report_spec(jsonb), public.run_report(jsonb, uuid[], uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.run_report_self(jsonb, uuid[]) from public, anon;
grant execute on function public.run_report_self(jsonb, uuid[]) to authenticated;
