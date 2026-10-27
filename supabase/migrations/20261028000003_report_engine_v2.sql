-- Fase 6.5: motor de relatórios v2, para reproduzir os painéis do Pipedrive.
-- * Bases novas: organizations e persons (visibilidade pelo escopo da própria entidade).
-- * Campos novos (report_field) e campos "de registro ligado" por exists (report_xfield): atividade do lead,
--   lead/atividade da organização. O resultado do exists é só um booleano por linha.
-- * Campo personalizado como filtro: custom:<chave> (do próprio registro) e person.custom:<chave> (da pessoa).
-- * segment_by: segunda dimensão (barras empilhadas). Linhas viram [grupo, segmento, valor].
-- * period.relative: this_week, last_week, this_month, last_month, this_year, last_year, last_7_days,
--   last_30_days. Semana de domingo a sábado, datas em America/Sao_Paulo.
-- * Cartão de número com período: o resultado traz previous (mesma métrica no período anterior).
-- * chart 'list': registros com as colunas pedidas (columns), até 500 linhas.
-- * restrict_filters: o período do painel substitui o período do widget (antes recortava); aceita relative e
--   o filtro de funil (pipeline), aplicado só às bases que têm funil.
-- Mesmas regras da v1: SQL montado só a partir dos mapas fixos; valores do usuário sempre por $1.

-- 1. Campos --------------------------------------------------------------------------------------------------
create or replace function public.report_field(p_base text, p_field text, out expr text, out kind text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  ow text := case when p_base in ('revenue', 'stage_history') then 'd.owner_id' else 'r.owner_id' end;
  co text := case when p_base in ('revenue', 'stage_history') then 'd.company_id' else 'r.company_id' end;
  acts text := 'select count(*) from public.activities x where x.deleted_at is null and ';
begin
  if p_base not in ('leads', 'deals', 'activities', 'revenue', 'stage_history', 'organizations', 'persons')
     or p_field is null then
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
        when 'leads:organization' then expr := 'r.organization_id'; kind := 'uuid';
        when 'leads:person' then expr := 'r.person_id'; kind := 'uuid';
        when 'leads:activities_count' then
          expr := '(' || acts || '(x.lead_id = r.id or (r.person_id is not null and x.person_id = r.person_id)))';
          kind := 'num';

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
        when 'deals:source' then expr := 'r.source_id'; kind := 'uuid';
        when 'deals:value' then expr := 'public.report_deal_value(r.contract_value, r.estimated_value)'; kind := 'num';
        -- ganho: data do ganho; demais: fechamento previsto (previsão de receita do Pipedrive)
        when 'deals:close_or_won' then
          expr := 'coalesce((r.won_at at time zone ''America/Sao_Paulo'')::date, r.expected_close_date)'; kind := 'date';
        when 'deals:organization' then expr := 'r.organization_id'; kind := 'uuid';
        when 'deals:person' then expr := 'r.person_id'; kind := 'uuid';

        when 'activities:type' then expr := 'r.type_id'; kind := 'uuid';
        when 'activities:channel' then expr := 'r.channel_id'; kind := 'uuid';
        when 'activities:outcome' then expr := 'r.outcome_id'; kind := 'uuid';
        when 'activities:outcome_classification' then
          expr := '(select ao.classification from public.activity_outcomes ao where ao.id = r.outcome_id)'; kind := 'text';
        when 'activities:meeting_outcome' then expr := 'r.meeting_outcome'; kind := 'text';
        when 'activities:due_at' then expr := 'r.due_at'; kind := 'ts';
        when 'activities:completed_at' then expr := 'r.completed_at'; kind := 'ts';
        when 'activities:created_at' then expr := 'r.created_at'; kind := 'ts';
        when 'activities:done' then expr := 'case when r.done then ''done'' else ''open'' end'; kind := 'text';
        when 'activities:organization' then expr := 'r.organization_id'; kind := 'uuid';
        when 'activities:lead' then expr := 'r.lead_id'; kind := 'uuid';
        when 'activities:lead_source' then
          expr := '(select l.source_id from public.leads l where l.id = r.lead_id)'; kind := 'uuid';

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
        when 'stage_history:deal_status' then expr := 'd.status'; kind := 'text';
        when 'stage_history:deal_won_at' then expr := 'd.won_at'; kind := 'ts';

        when 'organizations:created_at' then expr := 'r.created_at'; kind := 'ts';
        when 'organizations:updated_at' then expr := 'r.updated_at'; kind := 'ts';
        when 'organizations:label' then expr := '''organizations'''; kind := 'label';
        when 'organizations:activities_count' then
          expr := '(' || acts || 'x.organization_id = r.id)'; kind := 'num';

        when 'persons:created_at' then expr := 'r.created_at'; kind := 'ts';
        when 'persons:label' then expr := '''persons'''; kind := 'label';
        when 'persons:organization' then expr := 'r.organization_id'; kind := 'uuid';
        when 'persons:activities_count' then
          expr := '(' || acts || 'x.person_id = r.id)'; kind := 'num';
        else null;
      end case;
  end case;
end $$;

-- Campos de registro ligado: tmpl é um exists com {c} no lugar da comparação sobre col.
create or replace function public.report_xfield(p_base text, p_field text, out tmpl text, out col text, out kind text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  lead_acts text := 'exists (select 1 from public.activities x where x.lead_id = r.id and x.deleted_at is null and {c})';
  org_acts text := 'exists (select 1 from public.activities x where x.organization_id = r.id and x.deleted_at is null and {c})';
  org_leads text := 'exists (select 1 from public.leads x where x.organization_id = r.id and x.deleted_at is null and {c})';
begin
  case p_base || ':' || coalesce(p_field, '')
    when 'leads:activity_outcome' then tmpl := lead_acts; col := 'x.outcome_id'; kind := 'uuid';
    when 'leads:activity_completed_at' then tmpl := lead_acts; col := 'x.completed_at'; kind := 'ts';
    when 'leads:activity_owner' then tmpl := lead_acts; col := 'x.owner_id'; kind := 'uuid';
    when 'organizations:lead_created_at' then tmpl := org_leads; col := 'x.created_at'; kind := 'ts';
    when 'organizations:activity_completed_at' then tmpl := org_acts; col := 'x.completed_at'; kind := 'ts';
    when 'organizations:activity_owner' then tmpl := org_acts; col := 'x.owner_id'; kind := 'uuid';
    else null;
  end case;
end $$;

-- Campo de qualquer tipo: nativo, ligado ou personalizado. tmpl só para os ligados.
create or replace function public.report_any_field(p_base text, p_field text, out expr text, out kind text, out tmpl text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_key text;
begin
  select f.expr, f.kind into expr, kind from public.report_field(p_base, p_field) f;
  if kind is not null then
    return;
  end if;
  select x.col, x.kind, x.tmpl into expr, kind, tmpl from public.report_xfield(p_base, p_field) x;
  if kind is not null then
    return;
  end if;
  if p_field ~ '^custom:[a-z][a-z0-9_]{0,39}$' and p_base in ('leads', 'deals', 'organizations', 'persons') then
    v_key := substr(p_field, 8);
    expr := format('nullif(r.custom_fields->>%L, '''')', v_key); kind := 'text';
  elsif p_field ~ '^person\.custom:[a-z][a-z0-9_]{0,39}$' and p_base in ('leads', 'deals', 'activities') then
    v_key := substr(p_field, 15);
    expr := format('(select nullif(p.custom_fields->>%L, '''') from public.persons p where p.id = r.person_id)', v_key);
    kind := 'text';
  end if;
end $$;

-- 2. Dimensões -----------------------------------------------------------------------------------------------
create or replace function public.report_dimension(p_base text, p_dim text, out k text, out l text, out j text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  ow text := case when p_base in ('revenue', 'stage_history') then 'd.owner_id' else 'r.owner_id' end;
  co text := case when p_base in ('revenue', 'stage_history') then 'd.company_id' else 'r.company_id' end;
  deal_status text := 'case %s when ''open'' then ''Aberto'' when ''won'' then ''Ganho'' when ''lost'' then ''Perdido'' end';
  org_name text := 'coalesce((select o.name from public.organizations o where o.id = r.organization_id), ''Sem organização'')';
  source_name text := 'coalesce((select s.name from public.lead_sources s where s.id = r.source_id), ''Sem canal'')';
begin
  case p_base || ':' || coalesce(p_dim, '')
    when 'leads:owner', 'deals:owner', 'activities:owner', 'revenue:owner', 'stage_history:owner',
         'organizations:owner', 'persons:owner' then
      k := ow;
      l := format('(select coalesce(nullif(p.full_name, ''''), p.email) from public.profiles p where p.id = %s)', ow);
    -- Equipe pelos team_members do dono. Dono em vários times: a linha conta em cada time
    -- (soma das linhas pode passar do total). Dono sem time vai para "Sem equipe".
    when 'leads:team', 'deals:team', 'activities:team', 'organizations:team', 'persons:team' then
      j := format('left join lateral (select t.id, t.name from public.team_members tm '
                  'join public.teams t on t.id = tm.team_id where tm.user_id = %s) dt on true', ow);
      k := 'dt.id';
      l := 'coalesce(dt.name, ''Sem equipe'')';
    when 'leads:company', 'deals:company', 'activities:company', 'revenue:company', 'organizations:company',
         'persons:company' then
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
    when 'leads:source', 'deals:source' then
      k := 'r.source_id'; l := source_name;
    -- Etiqueta: registro com várias etiquetas conta em cada; sem etiqueta vai para "Sem etiqueta".
    when 'leads:label', 'deals:label', 'persons:label', 'organizations:label' then
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
    when 'leads:organization', 'deals:organization', 'activities:organization', 'persons:organization' then
      k := 'r.organization_id'; l := org_name;
    when 'activities:type' then
      k := 'r.type_id';
      l := '(select t.name from public.activity_types t where t.id = r.type_id)';
    when 'activities:channel' then
      k := 'r.channel_id';
      l := '(select ch.name from public.activity_channels ch where ch.id = r.channel_id)';
    -- "Tipo" do Pipedrive: reunião pelo tipo; o resto pelo canal (WhatsApp, Telefone, LinkedIn, E-mail)
    when 'activities:kind' then
      k := '(select case when t.is_meeting then t.name else (select ch.name from public.activity_channels ch '
           'where ch.id = r.channel_id) end from public.activity_types t where t.id = r.type_id)';
      l := k;
    when 'activities:done' then
      k := 'r.done'; l := 'case when r.done then ''Concluída'' else ''A fazer'' end';
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

create or replace function public.report_dimension_label(p_dim text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_dim
    when 'owner' then 'Responsável' when 'team' then 'Equipe' when 'company' then 'Empresa'
    when 'status' then 'Status' when 'source' then 'Canal de origem' when 'label' then 'Etiqueta'
    when 'month' then 'Mês' when 'pipeline' then 'Funil' when 'stage' then 'Etapa'
    when 'lost_reason' then 'Motivo de perda' when 'type' then 'Tipo' when 'channel' then 'Canal'
    when 'outcome' then 'Resultado' when 'outcome_classification' then 'Classificação do resultado'
    when 'meeting_outcome' then 'Resultado da reunião' when 'deal_status' then 'Status do negócio'
    when 'from_stage' then 'Etapa de origem' when 'to_stage' then 'Etapa de destino'
    when 'organization' then 'Organização' when 'kind' then 'Tipo' when 'done' then 'Concluída'
  end;
$$;

-- Dimensão completa (mês, personalizado ou do mapa). sfx renomeia os aliases dos joins (segunda dimensão).
create or replace function public.report_dim(p_base text, p_dim text, p_date_expr text, p_date_kind text, p_sfx text,
  out k text, out l text, out j text, out label text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_dim record;
  v_key text;
begin
  if p_dim = 'month' then
    k := case when p_date_kind = 'ts'
      then format('date_trunc(''month'', %s at time zone ''America/Sao_Paulo'')::date', p_date_expr)
      else format('date_trunc(''month'', %s::timestamp)::date', p_date_expr) end;
    l := format('to_char(%s, ''YYYY-MM-DD'')', k);
    j := '';
    label := 'Mês';
  elsif p_dim like 'custom:%' then
    v_key := substr(p_dim, 8);
    k := format('coalesce(nullif(r.custom_fields->>%L, ''''), ''Sem valor'')', v_key);
    l := k; j := ''; label := v_key;
  else
    select * into v_dim from public.report_dimension(p_base, p_dim);
    k := v_dim.k; l := v_dim.l; j := coalesce(' ' || v_dim.j, '');
    label := public.report_dimension_label(p_dim);
    if p_sfx <> '' then
      k := regexp_replace(k, '\m(dl|dt)\M', '\1' || p_sfx, 'g');
      l := regexp_replace(l, '\m(dl|dt)\M', '\1' || p_sfx, 'g');
      j := regexp_replace(j, '\m(dl|dt)\M', '\1' || p_sfx, 'g');
    end if;
  end if;
end $$;

-- Rótulo de dimensão custom:<chave>: campo select ativo da base em alguma das empresas. Sem campo, a spec é
-- inválida (como na v1). Outras dimensões: null.
create or replace function public.report_custom_label(p_base text, p_dim text, p_companies uuid[]) returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_label text;
begin
  if p_dim is null or p_dim not like 'custom:%' then
    return null;
  end if;
  select min(cf.label) into v_label from public.custom_field_defs cf
   where cf.company_id = any (p_companies) and cf.entity = p_base and cf.key = substr(p_dim, 8)
     and cf.type = 'select' and cf.archived_at is null;
  if v_label is null and coalesce(cardinality(p_companies), 0) > 0 then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'group_by';
  end if;
  return v_label;
end $$;

-- 3. Colunas da lista ----------------------------------------------------------------------------------------
create or replace function public.report_list_column(p_base text, p_key text, out expr text, out label text, out type text)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  deal_status text := 'case %s when ''open'' then ''Aberto'' when ''won'' then ''Ganho'' when ''lost'' then ''Perdido'' end';
  ow text := 'r.owner_id';
begin
  if p_base not in ('leads', 'deals', 'activities', 'organizations', 'persons') or p_key is null then
    return;
  end if;
  type := 'text';
  if p_key = 'owner' then
    expr := format('(select coalesce(nullif(p.full_name, ''''), p.email) from public.profiles p where p.id = %s)', ow);
    label := 'Responsável';
    return;
  elsif p_key = 'organization' and p_base <> 'organizations' then
    expr := '(select o.name from public.organizations o where o.id = r.organization_id)'; label := 'Organização';
    return;
  elsif p_key = 'person' and p_base in ('leads', 'deals', 'activities') then
    expr := '(select p.full_name from public.persons p where p.id = r.person_id)'; label := 'Pessoa';
    return;
  elsif p_key = 'created_at' then
    expr := '(r.created_at at time zone ''America/Sao_Paulo'')::date'; label := 'Criado em'; type := 'date';
    return;
  elsif p_key ~ '^custom:[a-z][a-z0-9_]{0,39}$' and p_base in ('leads', 'deals', 'organizations', 'persons') then
    expr := format('nullif(r.custom_fields->>%L, '''')', substr(p_key, 8)); label := substr(p_key, 8);
    return;
  end if;
  case p_base || ':' || p_key
    when 'deals:title' then expr := 'r.title'; label := 'Título';
    when 'deals:stage' then expr := '(select s.name from public.stages s where s.id = r.stage_id)'; label := 'Etapa';
    when 'deals:pipeline' then expr := '(select pl.name from public.pipelines pl where pl.id = r.pipeline_id)'; label := 'Funil';
    when 'deals:status' then expr := format(deal_status, 'r.status'); label := 'Status';
    when 'deals:value' then
      expr := 'public.report_deal_value(r.contract_value, r.estimated_value)'; label := 'Valor do negócio'; type := 'currency';
    when 'deals:estimated_value' then expr := 'r.estimated_value'; label := 'Valor do negócio'; type := 'currency';
    when 'deals:setup_total' then expr := 'r.setup_total'; label := 'Setup'; type := 'currency';
    when 'deals:mrr' then expr := 'r.mrr'; label := 'MRR'; type := 'currency';
    when 'deals:expected_close_date' then expr := 'r.expected_close_date'; label := 'Fechamento previsto'; type := 'date';
    when 'deals:won_at' then expr := '(r.won_at at time zone ''America/Sao_Paulo'')::date'; label := 'Ganho em'; type := 'date';
    when 'deals:lost_at' then expr := '(r.lost_at at time zone ''America/Sao_Paulo'')::date'; label := 'Perdido em'; type := 'date';
    when 'deals:lost_reason' then
      expr := '(select lr.name from public.lost_reasons lr where lr.id = r.lost_reason_id)'; label := 'Motivo de perda';
    when 'deals:source' then
      expr := '(select s.name from public.lead_sources s where s.id = r.source_id)'; label := 'Canal de origem';
    when 'leads:title' then expr := 'r.title'; label := 'Título';
    when 'leads:status' then
      expr := 'case r.status when ''open'' then ''Aberto'' when ''converted'' then ''Convertido'' '
              'when ''disqualified'' then ''Desqualificado'' when ''archived'' then ''Arquivado'' end';
      label := 'Status';
    when 'leads:source' then
      expr := '(select s.name from public.lead_sources s where s.id = r.source_id)'; label := 'Canal de origem';
    when 'leads:estimated_value' then expr := 'r.estimated_value'; label := 'Valor estimado'; type := 'currency';
    when 'organizations:name' then expr := 'r.name'; label := 'Nome';
    when 'organizations:updated_at' then
      expr := '(r.updated_at at time zone ''America/Sao_Paulo'')::date'; label := 'Atualizado em'; type := 'date';
    when 'persons:name' then expr := 'r.full_name'; label := 'Nome';
    when 'activities:subject' then expr := 'r.subject'; label := 'Assunto';
    when 'activities:type' then expr := '(select t.name from public.activity_types t where t.id = r.type_id)'; label := 'Tipo';
    when 'activities:channel' then
      expr := '(select ch.name from public.activity_channels ch where ch.id = r.channel_id)'; label := 'Canal';
    when 'activities:outcome' then
      expr := '(select ao.name from public.activity_outcomes ao where ao.id = r.outcome_id)'; label := 'Resultado';
    when 'activities:due_at' then
      expr := '(r.due_at at time zone ''America/Sao_Paulo'')::date'; label := 'Vencimento'; type := 'date';
    when 'activities:completed_at' then
      expr := '(r.completed_at at time zone ''America/Sao_Paulo'')::date'; label := 'Concluída em'; type := 'date';
    when 'activities:done' then expr := 'case when r.done then ''Concluída'' else ''A fazer'' end'; label := 'Situação';
    else
      expr := null; label := null; type := null;
  end case;
end $$;

-- 4. Período ---------------------------------------------------------------------------------------------------
-- Intervalo de um período relativo; p_back volta n períodos (1 = anterior, para comparação).
create or replace function public.report_relative_bounds(p_relative text, p_back int, out d_from date, out d_to date)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  ws date := today - extract(dow from today)::int;
  ms date := date_trunc('month', today)::date;
  ys date := date_trunc('year', today)::date;
begin
  case p_relative
    when 'this_week' then d_from := ws - 7 * p_back; d_to := d_from + 6;
    when 'last_week' then d_from := ws - 7 * (1 + p_back); d_to := d_from + 6;
    when 'this_month' then d_from := (ms - make_interval(months => p_back))::date;
      d_to := (d_from + interval '1 month')::date - 1;
    when 'last_month' then d_from := (ms - make_interval(months => 1 + p_back))::date;
      d_to := (d_from + interval '1 month')::date - 1;
    when 'this_year' then d_from := (ys - make_interval(years => p_back))::date;
      d_to := (d_from + interval '1 year')::date - 1;
    when 'last_year' then d_from := (ys - make_interval(years => 1 + p_back))::date;
      d_to := (d_from + interval '1 year')::date - 1;
    when 'last_7_days' then d_to := today - 7 * p_back; d_from := d_to - 6;
    when 'last_30_days' then d_to := today - 30 * p_back; d_from := d_to - 29;
    else null;
  end case;
end $$;

-- Período da spec com from/to resolvidos (relative vira datas). Sem período: null.
create or replace function public.report_resolve_period(p_period jsonb, p_back int default 0) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  b record;
  v_from date;
  v_to date;
  v_len int;
begin
  if coalesce(jsonb_typeof(p_period), 'null') <> 'object' then
    return null;
  end if;
  if p_period ? 'relative' then
    select * into b from public.report_relative_bounds(p_period->>'relative', p_back);
    v_from := b.d_from; v_to := b.d_to;
  else
    v_from := (p_period->>'from')::date;
    v_to := (p_period->>'to')::date;
    if p_back > 0 then
      v_len := v_to - v_from + 1;
      v_to := v_from - 1 - (p_back - 1) * v_len;
      v_from := v_to - v_len + 1;
    end if;
  end if;
  return (p_period - 'relative') || jsonb_build_object('from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_to, 'YYYY-MM-DD'));
end $$;

-- 5. Validação -------------------------------------------------------------------------------------------------
create or replace function public.validate_report_custom(p_spec jsonb) returns void
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
  g text;
  reason text;
begin
  reason := case
    when p_spec is null or jsonb_typeof(p_spec) <> 'object' then 'spec'
    when exists (select 1 from jsonb_object_keys(p_spec) x
                 where x not in ('kind', 'base', 'metric', 'group_by', 'segment_by', 'filters', 'period', 'chart',
                                 'columns', 'compare', 'cumulative')) then 'keys'
    when p_spec->'kind' is distinct from '"custom"'::jsonb then 'kind'
    when jsonb_typeof(p_spec->'base') is distinct from 'string'
      or p_spec->>'base' not in ('leads', 'deals', 'activities', 'revenue', 'stage_history', 'organizations', 'persons') then 'base'
    when jsonb_typeof(p_spec->'chart') is distinct from 'string'
      or p_spec->>'chart' not in ('number', 'bar', 'column', 'line', 'funnel', 'pie', 'table', 'list') then 'chart'
    when jsonb_typeof(p_spec->'metric') is distinct from 'object'
      or exists (select 1 from jsonb_object_keys(p_spec->'metric') x where x not in ('op', 'field')) then 'metric'
    when jsonb_typeof(p_spec->'metric'->'op') is distinct from 'string'
      or p_spec->'metric'->>'op' not in ('count', 'sum', 'avg', 'conversion_rate', 'avg_days') then 'metric.op'
    when coalesce(jsonb_typeof(p_spec->'metric'->'field'), 'null') not in ('null', 'string') then 'metric.field'
    when coalesce(jsonb_typeof(p_spec->'group_by'), 'null') not in ('null', 'string') then 'group_by'
    when coalesce(jsonb_typeof(p_spec->'segment_by'), 'null') not in ('null', 'string') then 'segment_by'
    when p_spec ? 'segment_by' and jsonb_typeof(p_spec->'segment_by') = 'string'
      and coalesce(jsonb_typeof(p_spec->'group_by'), 'null') <> 'string' then 'segment_by'
    when coalesce(jsonb_typeof(p_spec->'filters'), 'null') not in ('null', 'array') then 'filters'
    when coalesce(jsonb_typeof(p_spec->'period'), 'null') not in ('null', 'object') then 'period'
    when coalesce(jsonb_typeof(p_spec->'compare'), 'null') not in ('null', 'boolean') then 'compare'
    when coalesce(jsonb_typeof(p_spec->'cumulative'), 'null') not in ('null', 'boolean') then 'cumulative'
    when p_spec->>'chart' = 'list' and (jsonb_typeof(p_spec->'columns') is distinct from 'array'
      or jsonb_array_length(p_spec->'columns') not between 1 and 15) then 'columns'
    when p_spec->>'chart' <> 'list' and coalesce(jsonb_typeof(p_spec->'columns'), 'null') <> 'null' then 'columns'
  end;
  if reason is not null then
    raise exception 'OXYN_INVALID_REPORT' using detail = reason;
  end if;

  v_base := p_spec->>'base';
  v_op := p_spec->'metric'->>'op';
  v_field := p_spec->'metric'->>'field';

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

  -- agrupamento e segmento
  foreach g in array array[p_spec->>'group_by', p_spec->>'segment_by'] loop
    continue when g is null;
    if g like 'custom:%' then
      if v_base not in ('leads', 'deals', 'organizations', 'persons') or substr(g, 8) !~ '^[a-z][a-z0-9_]{0,39}$' then
        raise exception 'OXYN_INVALID_REPORT' using detail = 'group_by';
      end if;
    elsif g <> 'month' and (public.report_dimension(v_base, g)).k is null then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'group_by';
    end if;
  end loop;

  -- colunas da lista
  if p_spec->>'chart' = 'list' then
    for e in select x from jsonb_array_elements(p_spec->'columns') x loop
      if jsonb_typeof(e) <> 'string' or (public.report_list_column(v_base, e #>> '{}')).expr is null then
        raise exception 'OXYN_INVALID_REPORT' using detail = 'columns';
      end if;
    end loop;
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
    v_kind := (public.report_any_field(v_base, f->>'field')).kind;
    v := f->'value';
    if v_kind is null then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filter.field';
    end if;
    if not (f->>'op' = any (case
         when v_kind in ('uuid', 'text') then array['eq', 'in', 'not_in', 'is_null', 'not_null']
         when v_kind in ('team', 'label') then array['eq', 'in']
         else array['eq', 'gte', 'lte', 'between', 'is_null', 'not_null'] end)) then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filter.op';
    end if;
    reason := null;
    case f->>'op'
      when 'eq', 'gte', 'lte' then
        if not public.report_valid_scalar(v_kind, v) then reason := 'filter.value'; end if;
      when 'in', 'not_in' then
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

  -- período: campo de data e (from, to) ou relative
  if coalesce(jsonb_typeof(p_spec->'period'), 'null') = 'object' then
    f := p_spec->'period';
    v_kind := (public.report_any_field(v_base, f->>'field')).kind;
    if jsonb_typeof(f->'field') is distinct from 'string' or v_kind is null or v_kind not in ('ts', 'date') then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'period';
    end if;
    if f ? 'relative' then
      if exists (select 1 from jsonb_object_keys(f) x where x not in ('field', 'relative'))
         or jsonb_typeof(f->'relative') is distinct from 'string'
         or f->>'relative' not in ('this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year',
                                   'last_7_days', 'last_30_days') then
        raise exception 'OXYN_INVALID_REPORT' using detail = 'period';
      end if;
    elsif exists (select 1 from jsonb_object_keys(f) x where x not in ('field', 'from', 'to'))
       or not public.report_valid_date(f->'from') or not public.report_valid_date(f->'to')
       or (f->>'from')::date > (f->>'to')::date then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'period';
    end if;
  end if;
end $$;

-- 6. Execução --------------------------------------------------------------------------------------------------
create or replace function public.run_report_custom(p_spec jsonb, p_companies uuid[], p_viewer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_spec jsonb := p_spec;
  v_base text;
  v_op text;
  v_group text;
  v_segment text;
  v_chart text;
  v_entity text;
  v_alias text;
  v_from text;
  v_where text;
  v_vis text;
  v_key text;
  v_date_field text;
  v_date record;
  v_g record;
  v_s record;
  v_met record;
  v_fld record;
  v_col record;
  v_lhs text;
  v_cast text;
  v_val text;
  v_clause text;
  v_order text;
  v_inner text;
  v_sel text := '';
  v_total jsonb;
  v_prev jsonb;
  v_rows jsonb;
  v_cols jsonb;
  v_period jsonb;
  v_own_date boolean := false;
  v_g_label text;
  v_s_label text;
  f jsonb;
  c jsonb;
  i int := 0;
begin
  v_base := v_spec->>'base';
  v_op := v_spec->'metric'->>'op';
  v_group := nullif(v_spec->>'group_by', '');
  v_segment := nullif(v_spec->>'segment_by', '');
  v_chart := v_spec->>'chart';
  v_entity := case v_base when 'revenue' then 'deals' when 'stage_history' then 'deals' else v_base end;
  v_alias := case when v_base in ('revenue', 'stage_history') then 'd' else 'r' end;

  -- período relativo vira datas antes de tudo (os valores são lidos de $1)
  v_period := public.report_resolve_period(v_spec->'period');
  if v_period is not null then
    v_spec := jsonb_set(v_spec, '{period}', v_period);
  end if;

  -- Visibilidade aplicada uma vez por linha da entidade base (revenue e stage_history: negócio dono),
  -- avaliando can_access_for uma vez por par (empresa, dono).
  v_vis := format(
    'select c.company_id, c.owner_id from (select distinct t.company_id, t.owner_id from public.%I t '
    'where t.company_id = any ($2) and t.deleted_at is null) c '
    'where public.can_access_for($3, c.company_id, %L, c.owner_id, ''read'')', v_entity, v_entity);
  v_from := case v_base
    when 'revenue' then 'public.deal_revenue_schedule r join public.deals d on d.id = r.deal_id'
    when 'stage_history' then 'public.deal_stage_history r join public.deals d on d.id = r.deal_id'
    else format('public.%I r', v_base)
  end || format(' join vis on vis.company_id = %1$s.company_id and vis.owner_id = %1$s.owner_id', v_alias);
  v_where := format('%1$s.deleted_at is null and %1$s.company_id = any ($2)', v_alias);
  if v_base = 'revenue' then
    v_where := v_where || ' and d.status <> ''lost''';
  end if;

  -- filtros: valores sempre lidos de $1 pelo índice do filtro
  for f in select x from jsonb_array_elements(coalesce(v_spec->'filters', '[]'::jsonb)) x loop
    select * into v_fld from public.report_any_field(v_base, f->>'field');
    v_cast := case v_fld.kind when 'text' then 'text' when 'num' then 'numeric'
      when 'ts' then 'date' when 'date' then 'date' else 'uuid' end;
    v_lhs := case when v_fld.kind = 'ts' then format('(%s at time zone ''America/Sao_Paulo'')::date', v_fld.expr)
      else v_fld.expr end;
    v_val := case f->>'op'
      when 'in' then format('array(select jsonb_array_elements_text($1->''filters''->%s->''value''))::%s[]', i, v_cast)
      when 'not_in' then format('array(select jsonb_array_elements_text($1->''filters''->%s->''value''))::%s[]', i, v_cast)
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
        -- sem valor também fica fora de "não é nenhum de" (igual ao Pipedrive)
        when 'not_in' then format('(%1$s is null or not (%1$s = any (%2$s)))', v_lhs, v_val)
        when 'gte' then format('%s >= %s', v_lhs, v_val)
        when 'lte' then format('%s <= %s', v_lhs, v_val)
        when 'between' then format('%s between %s', v_lhs, v_val)
        when 'is_null' then format('%s is null', v_lhs)
        when 'not_null' then format('%s is not null', v_lhs) end;
    end if;
    if v_fld.tmpl is not null then
      v_clause := replace(v_fld.tmpl, '{c}', v_clause);
    end if;
    v_where := v_where || ' and ' || v_clause;
    i := i + 1;
  end loop;

  -- período (datas inclusivas, pela data em São Paulo)
  if v_period is not null then
    v_date_field := v_spec->'period'->>'field';
    select * into v_date from public.report_any_field(v_base, v_date_field);
    v_clause := format('%s between ($1#>>''{period,from}'')::date and ($1#>>''{period,to}'')::date',
      case when v_date.kind = 'ts' then format('(%s at time zone ''America/Sao_Paulo'')::date', v_date.expr)
           else v_date.expr end);
    if v_date.tmpl is not null then
      v_clause := replace(v_date.tmpl, '{c}', v_clause);
    else
      v_own_date := true;
    end if;
    v_where := v_where || ' and ' || v_clause;
  end if;
  -- agrupamento por mês usa a data do período; campo de registro ligado usa a data própria da base
  if not v_own_date then
    v_date_field := case v_base when 'activities' then 'due_at' when 'revenue' then 'month'
      when 'stage_history' then 'moved_at' else 'created_at' end;
    select * into v_date from public.report_any_field(v_base, v_date_field);
  end if;

  -- lista de registros
  if v_chart = 'list' then
    v_cols := '[]'::jsonb;
    for c in select x from jsonb_array_elements(v_spec->'columns') x loop
      select * into v_col from public.report_list_column(v_base, c #>> '{}');
      -- coluna de campo personalizado leva o rótulo do campo
      if (c #>> '{}') like 'custom:%' then
        v_col.label := coalesce((select min(cf.label) from public.custom_field_defs cf
          where cf.company_id = any (p_companies) and cf.entity = v_base and cf.key = substr(c #>> '{}', 8)), v_col.label);
      end if;
      v_sel := v_sel || case when v_sel = '' then '' else ', ' end || v_col.expr;
      v_cols := v_cols || jsonb_build_array(jsonb_build_object('key', c #>> '{}', 'label', v_col.label, 'type', v_col.type));
    end loop;
    execute format(
      'with vis as materialized (%s) '
      'select coalesce(jsonb_agg(x.row order by x.rn), ''[]''::jsonb) from ('
      '  select jsonb_build_array(%s) as row, row_number() over (order by %s.created_at desc, %s.id) as rn'
      '  from %s where %s order by rn limit 501) x',
      v_vis, v_sel, 'r', 'r', v_from, v_where)
      into v_rows using v_spec, p_companies, p_viewer;
    return public.report_cap_rows(jsonb_build_object('columns', v_cols, 'rows', v_rows, 'total', null));
  end if;

  select * into v_met from public.report_metric(v_base, v_op, v_spec->'metric'->>'field');

  -- total, sem agrupamento
  v_inner := format('select %s as m, %s as n from %s where %s', v_met.m, v_met.n, v_from, v_where);
  execute format('with vis as materialized (%s) select to_jsonb(%s) from (%s) x', v_vis, v_met.agg, v_inner)
    into v_total using v_spec, p_companies, p_viewer;
  v_total := coalesce(v_total, 'null'::jsonb);

  -- cartão de número com período: mesma métrica no período anterior
  if v_chart = 'number' and v_period is not null and coalesce((v_spec->>'compare')::boolean, true) then
    v_prev := public.run_report_custom(
      jsonb_set(p_spec, '{period}', public.report_resolve_period(p_spec->'period', 1)) || '{"compare": false}',
      p_companies, p_viewer)->'total';
  end if;

  if v_group is null then
    v_rows := jsonb_build_array(jsonb_build_array(v_total));
  else
    select * into v_g from public.report_dim(v_base, v_group, v_date.expr, v_date.kind, '');
    v_g_label := coalesce(public.report_custom_label(v_base, v_group, p_companies), v_g.label);
    v_order := case when v_group = 'month' then 'k' else 'gv desc nulls last, l, k::text' end;
    if v_segment is null then
      v_inner := format('select %s as k, %s as l, %s as m, %s as n from %s%s where %s',
        v_g.k, v_g.l, v_met.m, v_met.n, v_from, v_g.j, v_where);
      execute format(
        'with vis as materialized (%s) '
        'select coalesce(jsonb_agg(jsonb_build_array(g.l, g.v) order by g.rn), ''[]''::jsonb) from ('
        '  select l, v, row_number() over (order by %s) as rn'
        '  from (select k, l, %s as v, %s as gv from (%s) x group by k, l) y'
        '  order by rn limit 501) g',
        v_vis, v_order, v_met.agg, v_met.agg, v_inner)
        into v_rows using v_spec, p_companies, p_viewer;
    else
      select * into v_s from public.report_dim(v_base, v_segment, v_date.expr, v_date.kind, '2');
      v_s_label := coalesce(public.report_custom_label(v_base, v_segment, p_companies), v_s.label);
      v_inner := format('select %s as k, %s as l, %s as sk, %s as sl, %s as m, %s as n from %s%s%s where %s',
        v_g.k, v_g.l, v_s.k, v_s.l, v_met.m, v_met.n, v_from, v_g.j, v_s.j, v_where);
      -- ordem dos grupos pelo total do grupo; segmentos por nome
      execute format(
        'with vis as materialized (%s), base as (%s), '
        'gt as (select k, l, %s as gv from base x group by k, l), '
        'gs as (select x.k, x.l, x.sk, x.sl, %s as v from base x group by x.k, x.l, x.sk, x.sl) '
        'select coalesce(jsonb_agg(jsonb_build_array(z.l, z.sl, z.v) order by z.rn, z.sl), ''[]''::jsonb) from ('
        '  select gs.l, gs.sl, gs.v, dense_rank() over (order by %s) as rn'
        '  from gs join gt on gt.k is not distinct from gs.k and gt.l is not distinct from gs.l) z '
        'where z.rn <= 200',
        v_vis, v_inner, v_met.agg, v_met.agg,
        case when v_group = 'month' then 'gt.k' else 'gt.gv desc nulls last, gt.l, gt.k::text' end)
        into v_rows using v_spec, p_companies, p_viewer;
    end if;
  end if;

  v_cols := case when v_group is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('key', v_group, 'label', v_g_label,
      'type', case when v_group = 'month' then 'month' else 'text' end)) end
    || case when v_segment is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object('key', 'segment:' || v_segment, 'label', v_s_label,
      'type', case when v_segment = 'month' then 'month' else 'text' end)) end
    || jsonb_build_array(jsonb_build_object('key', 'value', 'label', v_met.label, 'type', v_met.type));

  return public.report_cap_rows(jsonb_build_object('columns', v_cols, 'rows', v_rows,
    'total', case when v_chart = 'table' then null else v_total end)
    || case when v_prev is not null then jsonb_build_object('previous', v_prev) else '{}'::jsonb end);
end $$;

-- 7. Filtros do painel -----------------------------------------------------------------------------------------
-- Corpo da 20261025000011 com três mudanças: período relativo; período do painel substitui o do widget
-- (mantendo o campo de data do widget) e, como no Pipedrive, não toca relatório personalizado sem período;
-- filtro de funil vira filtro "pipeline" nas bases que têm funil (custom de deals, revenue e stage_history;
-- presets com filtro pipeline). Nas demais, é ignorado.
create or replace function public.restrict_filters(p_spec jsonb, p_filters jsonb, p_allowed_companies uuid[],
  out spec jsonb, out companies uuid[])
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_f jsonb := case when p_filters is null or jsonb_typeof(p_filters) = 'null' then '{}'::jsonb else p_filters end;
  v_p jsonb;
  v_ids jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_empty boolean := false;
  v_from date;
  v_to date;
  v_pipe boolean;
  k text;
begin
  if jsonb_typeof(v_f) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_f) x where x not in ('company', 'owner', 'team', 'period', 'pipeline')) then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
  end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'spec';
  end if;
  if coalesce(jsonb_typeof(p_spec->'filters'), 'null') not in ('null', 'array') then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
  end if;
  spec := p_spec;

  -- empresas
  companies := array(select distinct c from unnest(coalesce(p_allowed_companies, '{}'::uuid[])) c where c is not null);
  if coalesce(jsonb_typeof(v_f->'company'), 'null') <> 'null' then
    v_ids := public.restrict_filter_ids(v_f->'company');
    companies := array(select c from unnest(companies) c
                       where c = any (array(select x::uuid from jsonb_array_elements_text(v_ids) x)));
  end if;

  -- responsável, equipe e funil
  v_pipe := case when spec->>'kind' = 'custom' then spec->>'base' in ('deals', 'revenue', 'stage_history')
    else 'pipeline' = any (public.report_preset_filters(spec->>'kind', spec->'params')) end;
  foreach k in array array['owner', 'team', 'pipeline'] loop
    continue when k = 'pipeline' and not v_pipe;
    if coalesce(jsonb_typeof(v_f->k), 'null') <> 'null' then
      v_ids := public.restrict_filter_ids(v_f->k);
      if jsonb_array_length(v_ids) = 0 then
        v_empty := true;
      else
        v_extra := v_extra || jsonb_build_array(jsonb_build_object('field', k, 'op', 'in', 'value', v_ids));
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_extra) > 0 then
    spec := jsonb_set(spec, '{filters}',
      coalesce(nullif(spec->'filters', 'null'::jsonb), '[]'::jsonb) || v_extra);
  end if;

  -- período: o do painel substitui o do widget
  if coalesce(jsonb_typeof(v_f->'period'), 'null') <> 'null' then
    v_p := v_f->'period';
    if jsonb_typeof(v_p) <> 'object' then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
    end if;
    if v_p ? 'relative' then
      if exists (select 1 from jsonb_object_keys(v_p) x where x <> 'relative')
         or (public.report_relative_bounds(v_p->>'relative', 0)).d_from is null then
        raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
      end if;
      v_from := (public.report_relative_bounds(v_p->>'relative', 0)).d_from;
      v_to := (public.report_relative_bounds(v_p->>'relative', 0)).d_to;
    elsif exists (select 1 from jsonb_object_keys(v_p) x where x not in ('from', 'to'))
       or not public.report_valid_date(v_p->'from') or not public.report_valid_date(v_p->'to')
       or (v_p->>'from')::date > (v_p->>'to')::date then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filters';
    else
      v_from := (v_p->>'from')::date;
      v_to := (v_p->>'to')::date;
    end if;
    if spec->'kind' = '"custom"'::jsonb then
      if jsonb_typeof(spec->'period') = 'object' then
        spec := spec || jsonb_build_object('period', jsonb_build_object('field', spec#>>'{period,field}')
          || case when v_p ? 'relative' then jsonb_build_object('relative', v_p->>'relative')
             else jsonb_build_object('from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_to, 'YYYY-MM-DD')) end);
      end if;
    else
      spec := spec || jsonb_build_object('period', jsonb_build_object(
        'from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_to, 'YYYY-MM-DD')));
    end if;
  elsif spec->'kind' is distinct from '"custom"'::jsonb and spec#>>'{period,relative}' is not null then
    -- preset com período relativo próprio
    v_from := (public.report_relative_bounds(spec#>>'{period,relative}', 0)).d_from;
    v_to := (public.report_relative_bounds(spec#>>'{period,relative}', 0)).d_to;
    spec := jsonb_set(spec, '{period}', jsonb_build_object('from', to_char(v_from, 'YYYY-MM-DD'), 'to', to_char(v_to, 'YYYY-MM-DD')));
  end if;

  if v_empty then
    companies := '{}'::uuid[];
  end if;
end $$;

-- 8. Permissões: auxiliares só para o motor ----------------------------------------------------------------------
revoke execute on function public.report_xfield(text, text), public.report_any_field(text, text),
  public.report_dim(text, text, text, text, text), public.report_list_column(text, text),
  public.report_relative_bounds(text, int), public.report_resolve_period(jsonb, int),
  public.report_custom_label(text, text, uuid[])
  from public, anon, authenticated, service_role;
