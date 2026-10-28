-- Insights: catálogo de campos (ids do Pipedrive) e motor de execução.
-- * Campo = (entidade, id). Expressões usam o alias r para o registro da entidade; tipos de relatório com base
--   própria usam h (histórico/duração) ou i (itens do negócio). Campos ligados (deal_id_, lead_id_, person_id_,
--   org_id_, activity_id_) reaproveitam o campo da outra entidade com o alias x, dentro de um exists.
-- * Valores do usuário entram só por $1 (filtros normalizados em $1->'f'); datas calculadas pelo motor entram
--   como literais. Visibilidade por can_access_for do viewer em cada par (empresa, dono).
-- * Datas no dia de America/Sao_Paulo; semana de domingo a sábado.

-- 1. Períodos -------------------------------------------------------------------------------------------------
create or replace function public.insights_period_bounds(p_period text, p_back int, p_from date, p_to date,
  out d_from date, out d_to date)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  ws date := today - extract(dow from today)::int;
  ms date := date_trunc('month', today)::date;
  qs date := date_trunc('quarter', today)::date;
  ys date := date_trunc('year', today)::date;
  b int := coalesce(p_back, 0);
  len int;
begin
  case p_period
    when 'today' then d_from := today - b; d_to := d_from;
    when 'yesterday' then d_from := today - 1 - b; d_to := d_from;
    when 'tomorrow' then d_from := today + 1 - b; d_to := d_from;
    when 'week' then d_from := ws - 7 * b; d_to := d_from + 6;
    when 'lastWeek' then d_from := ws - 7 * (1 + b); d_to := d_from + 6;
    when 'nextWeek' then d_from := ws + 7 * (1 - b); d_to := d_from + 6;
    when 'month' then d_from := (ms - make_interval(months => b))::date;
    when 'lastMonth' then d_from := (ms - make_interval(months => 1 + b))::date;
    when 'nextMonth' then d_from := (ms + make_interval(months => 1 - b))::date;
    when 'quarter' then d_from := (qs - make_interval(months => 3 * b))::date;
    when 'lastQuarter' then d_from := (qs - make_interval(months => 3 * (1 + b)))::date;
    when 'nextQuarter' then d_from := (qs + make_interval(months => 3 * (1 - b)))::date;
    when 'year' then d_from := (ys - make_interval(years => b))::date;
    when 'lastYear' then d_from := (ys - make_interval(years => 1 + b))::date;
    when 'nextYear' then d_from := (ys + make_interval(years => 1 - b))::date;
    when 'last7Days' then d_to := today - 7 * b; d_from := d_to - 6;
    when 'last30Days' then d_to := today - 30 * b; d_from := d_to - 29;
    when 'last90Days' then d_to := today - 90 * b; d_from := d_to - 89;
    when 'custom' then
      d_from := p_from; d_to := p_to;
      if b > 0 and p_from is not null and p_to is not null then
        len := p_to - p_from + 1;
        d_to := p_from - 1 - (b - 1) * len;
        d_from := d_to - len + 1;
      end if;
    else null;
  end case;
  if p_period in ('month', 'lastMonth', 'nextMonth') then
    d_to := (d_from + interval '1 month')::date - 1;
  elsif p_period in ('quarter', 'lastQuarter', 'nextQuarter') then
    d_to := (d_from + interval '3 months')::date - 1;
  elsif p_period in ('year', 'lastYear', 'nextYear') then
    d_to := (d_from + interval '1 year')::date - 1;
  end if;
end $$;

-- 2. Campos nativos ---------------------------------------------------------------------------------------------
-- roles: f filtro, g ver por, s segmentar por, m medir por, c coluna da lista. rts: tipos de relatório onde vale
-- (null = todos da entidade). opts: fonte das opções (users, stages...) ou lista fixa [[chave, rótulo], ...].
create or replace function public.insights_native_fields()
returns table (dtype text, id text, name text, ftype text, expr text, opts text, roles text, agg text, rts text)
language sql immutable set search_path = public, pg_temp as $f$
  select * from (values
  -- negócios
  ('deals', 'title', 'Título', 'TEXT', 'r.title', null, 'fgsc', null, null),
  ('deals', 'creatorUserId', 'Criador', 'USER', 'r.created_by', 'users', 'fgsc', null, null),
  ('deals', 'userId', 'Proprietário', 'USER', 'r.owner_id', 'users', 'fgsc', null, null),
  ('deals', 'orgId', 'Organização', 'ORGANIZATION', 'r.organization_id', 'orgs', 'fgsc', null, null),
  ('deals', 'personId', 'Pessoa de contato', 'PERSON', 'r.person_id', 'persons', 'fgsc', null, null),
  ('deals', 'addTime', 'Negócio criado em', 'DATE_TIME', 'r.created_at', null, 'fgc', null, null),
  ('deals', 'updateTime', 'Horário da atualização', 'DATE_TIME', 'r.updated_at', null, 'fgc', null, null),
  ('deals', 'status', 'Status', 'SINGLE_OPTION', 'r.status', '[["open","Aberto"],["won","Ganho"],["lost","Perdido"]]', 'fgsc', null, null),
  ('deals', 'active', 'Ativo', 'BOOLEAN', '(r.status = ''open'')', '[["true","Sim"],["false","Não"]]', 'f', null, null),
  ('deals', 'label', 'Etiqueta', 'MULTIPLE_OPTIONS', 'r.id', 'labels', 'fgsc', null, null),
  ('deals', 'teamId', 'Equipe', 'MULTIPLE_OPTIONS', 'r.owner_id', 'teams', 'fgs', null, null),
  ('deals', 'stageChangeTime', 'Última alteração de etapa', 'DATE_TIME', 'r.stage_entered_at', null, 'fgc', null, null),
  ('deals', 'stageId', 'Etapa', 'ID', 'r.stage_id', 'stages', 'fgsc', null, null),
  ('deals', 'closeTime', 'Negócio fechado em', 'DATE_TIME', 'coalesce(r.won_at, r.lost_at)', null, 'fgc', null, null),
  ('deals', 'expectedCloseDate', 'Data de fechamento esperada', 'DATE', 'r.expected_close_date', null, 'fgc', null, null),
  ('deals', 'lostReason', 'Motivo da perda', 'SINGLE_OPTION', 'r.lost_reason_id', 'lost_reasons', 'fgsc', null, null),
  ('deals', 'wonTime', 'Ganho em', 'DATE_TIME', 'r.won_at', null, 'fgc', null, null),
  ('deals', 'lostTime', 'Data de perda', 'DATE_TIME', 'r.lost_at', null, 'fgc', null, null),
  ('deals', 'pipelineId', 'Funil', 'ID', 'r.pipeline_id', 'pipelines', 'fgsc', null, null),
  ('deals', 'channel', 'Canal de origem', 'SINGLE_OPTION', 'r.source_id', 'channels', 'fgsc', null, null),
  ('deals', 'dealProductsProductId', 'Nome do produto', 'PRODUCT', 'r.id', 'products', 'f', null, null),
  ('deals', 'dealProductsProductId', 'Nome do produto', 'PRODUCT', 'i.product_id', 'products', 'fgsc', null, 'product_performance'),
  ('deals', 'nextActivityDate', 'Data da próxima atividade', 'DATE',
   '(select min((a.due_at at time zone ''America/Sao_Paulo'')::date) from public.activities a where a.deal_id = r.id and not a.done and a.deleted_at is null)',
   null, 'fgc', null, null),
  ('deals', 'lastActivityDate', 'Data da última atividade', 'DATE',
   '(select max((a.completed_at at time zone ''America/Sao_Paulo'')::date) from public.activities a where a.deal_id = r.id and a.done and a.deleted_at is null)',
   null, 'fgc', null, null),
  ('deals', 'expectedCloseDateOrWonTime', 'Período de previsão', 'DATE',
   'coalesce((r.won_at at time zone ''America/Sao_Paulo'')::date, r.expected_close_date)', null, 'fgc', null, 'revenue_forecast'),
  ('deals', 'value', 'Valor do negócio', 'MONETARY', 'r.estimated_value', null, 'fmc', 'sum', null),
  ('deals', 'avg', 'Valor médio do negócio', 'MONETARY', 'r.estimated_value', null, 'm', 'avg', null),
  ('deals', 'weightedValue', 'Valor ponderado', 'MONETARY',
   '(r.estimated_value * coalesce((select st.probability from public.stages st where st.id = r.stage_id), 100) / 100.0)',
   null, 'mc', 'sum', null),
  ('deals', 'mrr', 'MRR contratado', 'MONETARY', 'r.mrr', null, 'fmc', 'sum', null),
  ('deals', 'setupTotal', 'Setup', 'MONETARY', 'r.setup_total', null, 'fmc', 'sum', null),
  ('deals', 'contractMonths', 'Prazo (meses)', 'NUMERICAL', 'r.contract_months', null, 'fmc', 'avg', null),
  ('deals', 'contractValue', 'Valor do contrato', 'MONETARY', 'r.contract_value', null, 'fmc', 'sum', null),
  ('deals', 'dealProductsAmount', 'Quantidade de produtos', 'NUMERICAL',
   '(select sum(di.quantity) from public.deal_items di where di.deal_id = r.id)', null, 'm', 'sum', null),
  ('deals', 'dealProductsAmount', 'Quantidade de produtos', 'NUMERICAL', 'i.quantity', null, 'm', 'sum', 'product_performance'),
  ('deals', 'dealProductsSum', 'Quantia do produto', 'MONETARY',
   '(select sum(di.total) from public.deal_items di where di.deal_id = r.id)', null, 'm', 'sum', null),
  ('deals', 'dealProductsSum', 'Quantia do produto', 'MONETARY', 'i.total', null, 'm', 'sum', 'product_performance'),
  ('deals', 'dealStageLogStageId', 'Etapa de entrada', 'ID', 'h.stage_id', 'stages', 'fgs', null, 'duration,progress'),
  ('deals', 'dealStageLogAddTime', 'Data de entrada na etapa', 'DATE_TIME', 'h.moved_at', null, 'fg', null, 'progress'),
  ('deals', 'duration', 'Duração média', 'NUMERICAL', 'h.days', null, 'm', 'avg', 'duration'),
  ('deals', 'totalDuration', 'Duração total', 'NUMERICAL', 'h.days', null, 'm', 'sum', 'duration'),

  -- leads
  ('leads', 'title', 'Título', 'TEXT', 'r.title', null, 'fgsc', null, null),
  ('leads', 'creatorUserId', 'Criador', 'USER', 'r.created_by', 'users', 'fgsc', null, null),
  ('leads', 'userId', 'Proprietário', 'USER', 'r.owner_id', 'users', 'fgsc', null, null),
  ('leads', 'orgId', 'Organização', 'ORGANIZATION', 'r.organization_id', 'orgs', 'fgsc', null, null),
  ('leads', 'personId', 'Pessoa de contato', 'PERSON', 'r.person_id', 'persons', 'fgsc', null, null),
  ('leads', 'addTime', 'Lead criado em', 'DATE_TIME', 'r.created_at', null, 'fgc', null, null),
  ('leads', 'status', 'Status do lead', 'SINGLE_OPTION', 'r.status',
   '[["open","Aberto"],["converted","Convertido"],["disqualified","Desqualificado"],["archived","Arquivado"]]', 'fgsc', null, null),
  ('leads', 'active', 'Ativo', 'BOOLEAN', '(r.status = ''open'')', '[["true","Sim"],["false","Não"]]', 'f', null, null),
  ('leads', 'updateTime', 'Data da última atualização', 'DATE_TIME', 'r.updated_at', null, 'fgc', null, null),
  ('leads', 'convertTime', 'Lead convertido em negócio em', 'DATE_TIME', 'r.converted_at', null, 'fgc', null, null),
  ('leads', 'archiveReason', 'Motivo do arquivamento', 'SINGLE_OPTION', 'r.disqualification_reason_id', 'disq_reasons', 'fgsc', null, null),
  ('leads', 'channel', 'Canal de origem', 'SINGLE_OPTION', 'r.source_id', 'channels', 'fgsc', null, null),
  ('leads', 'label', 'Etiqueta', 'MULTIPLE_OPTIONS', 'r.id', 'labels', 'fgsc', null, null),
  ('leads', 'teamId', 'Equipe', 'MULTIPLE_OPTIONS', 'r.owner_id', 'teams', 'fgs', null, null),
  ('leads', 'nextActivityDate', 'Data da próxima atividade', 'DATE',
   '(select min((a.due_at at time zone ''America/Sao_Paulo'')::date) from public.activities a where a.lead_id = r.id and not a.done and a.deleted_at is null)',
   null, 'fgc', null, null),
  ('leads', 'value', 'Valor do lead', 'MONETARY', 'r.estimated_value', null, 'fmc', 'sum', null),
  ('leads', 'timeToConvert', 'Tempo médio para converter', 'NUMERICAL',
   '(extract(epoch from (r.converted_at - r.created_at)) / 86400.0)', null, 'm', 'avg', null),
  ('leads', 'totalTimeToConvert', 'Tempo total para converter', 'NUMERICAL',
   '(extract(epoch from (r.converted_at - r.created_at)) / 86400.0)', null, 'm', 'sum', null),

  -- atividades
  ('activities', 'userId', 'Usuário responsável', 'USER', 'r.owner_id', 'users', 'fgsc', null, null),
  ('activities', 'teamId', 'Equipe', 'MULTIPLE_OPTIONS', 'r.owner_id', 'teams', 'fgs', null, null),
  ('activities', 'done', 'Status', 'BOOLEAN', 'r.done', '[["false","A fazer"],["true","Concluída"]]', 'fgsc', null, null),
  ('activities', 'overdue', 'Em atraso/a vencer', 'BOOLEAN', '(not r.done and r.due_at < now())',
   '[["true","Em atraso"],["false","A vencer"]]', 'fgs', null, null),
  -- "Tipo" do Pipedrive: reunião pelo tipo; o resto pelo canal (WhatsApp, Ligação, LinkedIn, E-mail)
  ('activities', 'type', 'Tipo', 'SINGLE_OPTION',
   '(select case when t.is_meeting then t.id else coalesce(r.channel_id, t.id) end from public.activity_types t where t.id = r.type_id)',
   'kinds', 'fgsc', null, null),
  ('activities', 'activityType', 'Tipo de atividade', 'SINGLE_OPTION', 'r.type_id', 'acttypes', 'fgsc', null, null),
  ('activities', 'activityChannel', 'Canal', 'SINGLE_OPTION', 'r.channel_id', 'actchannels', 'fgsc', null, null),
  ('activities', 'originChannel', 'Canal de origem da reunião', 'SINGLE_OPTION', 'r.origin_channel_id', 'actchannels', 'fgsc', null, null),
  ('activities', 'outcome', 'Resultado', 'SINGLE_OPTION', 'r.outcome_id', 'outcomes', 'fgsc', null, null),
  ('activities', 'meetingOutcome', 'Resultado da reunião', 'SINGLE_OPTION', 'r.meeting_outcome',
   '[["held","Realizada"],["no_show","Não compareceu"],["rescheduled","Reagendada"],["canceled","Cancelada"]]', 'fgsc', null, null),
  ('activities', 'subject', 'Assunto', 'TEXT', 'r.subject', null, 'fgsc', null, null),
  ('activities', 'dueDate', 'Data de vencimento', 'DATE', '(r.due_at at time zone ''America/Sao_Paulo'')::date', null, 'fgc', null, null),
  ('activities', 'addTime', 'Data de criação', 'DATE_TIME', 'r.created_at', null, 'fgc', null, null),
  ('activities', 'markedAsDoneTime', 'Marcado como feito em', 'DATE_TIME', 'r.completed_at', null, 'fgc', null, null),
  ('activities', 'personId', 'Pessoa de contato', 'PERSON', 'r.person_id', 'persons', 'fgsc', null, null),
  ('activities', 'orgId', 'Organização', 'ORGANIZATION', 'r.organization_id', 'orgs', 'fgsc', null, null),
  ('activities', 'dealId', 'Negócio', 'DEAL', 'r.deal_id', 'deals', 'fc', null, null),
  ('activities', 'leadId', 'Lead', 'LEAD', 'r.lead_id', 'leads', 'fc', null, null),
  ('activities', 'writerId', 'Criador', 'USER', 'r.created_by', 'users', 'fgsc', null, null),
  ('activities', 'duration', 'Duração (min)', 'NUMERICAL', 'r.duration_minutes', null, 'fmc', 'sum', null),

  -- organizações
  ('organizations', 'ownerId', 'Proprietário', 'USER', 'r.owner_id', 'users', 'fgsc', null, null),
  ('organizations', 'teamId', 'Equipe', 'MULTIPLE_OPTIONS', 'r.owner_id', 'teams', 'fgs', null, null),
  ('organizations', 'name', 'Nome', 'TEXT', 'r.name', null, 'fgsc', null, null),
  ('organizations', 'label', 'Etiqueta', 'MULTIPLE_OPTIONS', 'r.id', 'labels', 'fgsc', null, null),
  ('organizations', 'addTime', 'Organização criada', 'DATE_TIME', 'r.created_at', null, 'fgc', null, null),
  ('organizations', 'updateTime', 'Atualizar tempo', 'DATE_TIME', 'r.updated_at', null, 'fgc', null, null),
  ('organizations', 'industry', 'Setor', 'TEXT', 'r.segment', null, 'fgsc', null, null),
  ('organizations', 'cnpj', 'CNPJ', 'TEXT', 'r.cnpj', null, 'fc', null, null),
  ('organizations', 'website', 'Site', 'TEXT', 'r.domain', null, 'fc', null, null),
  ('organizations', 'lastActivityDate', 'Data da última atividade', 'DATE',
   '(select max((a.completed_at at time zone ''America/Sao_Paulo'')::date) from public.activities a where a.organization_id = r.id and a.done and a.deleted_at is null)',
   null, 'fgc', null, null),
  ('organizations', 'nextActivityDate', 'Data da próxima atividade', 'DATE',
   '(select min((a.due_at at time zone ''America/Sao_Paulo'')::date) from public.activities a where a.organization_id = r.id and not a.done and a.deleted_at is null)',
   null, 'fgc', null, null),
  ('organizations', 'activitiesCount', 'Número de atividades', 'NUMERICAL',
   'nullif((select count(*) from public.activities a where a.organization_id = r.id and a.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('organizations', 'activitiesToDo', 'Número de atividades por fazer', 'NUMERICAL',
   'nullif((select count(*) from public.activities a where a.organization_id = r.id and not a.done and a.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('organizations', 'doneActivitiesCount', 'Número de atividades concluídas', 'NUMERICAL',
   'nullif((select count(*) from public.activities a where a.organization_id = r.id and a.done and a.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('organizations', 'closedDealsCount', 'Número de negócios fechados', 'NUMERICAL',
   'nullif((select count(*) from public.deals dd where dd.organization_id = r.id and dd.status in (''won'', ''lost'') and dd.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('organizations', 'lostDealsCount', 'Número de negócios perdidos', 'NUMERICAL',
   'nullif((select count(*) from public.deals dd where dd.organization_id = r.id and dd.status = ''lost'' and dd.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('organizations', 'openDealsCount', 'Número de negócios abertos', 'NUMERICAL',
   'nullif((select count(*) from public.deals dd where dd.organization_id = r.id and dd.status = ''open'' and dd.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('organizations', 'wonDealsCount', 'Número de negócios ganhos', 'NUMERICAL',
   'nullif((select count(*) from public.deals dd where dd.organization_id = r.id and dd.status = ''won'' and dd.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('organizations', 'peopleCount', 'Número de pessoas', 'NUMERICAL',
   'nullif((select count(*) from public.persons pp where pp.organization_id = r.id and pp.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('organizations', 'notesCount', 'Número de anotações', 'NUMERICAL',
   'nullif((select count(*) from public.notes nn where nn.entity = ''organizations'' and nn.record_id = r.id and nn.deleted_at is null), 0)', null, 'fmc', 'sum', null),

  -- pessoas
  ('people', 'ownerId', 'Proprietário', 'USER', 'r.owner_id', 'users', 'fgsc', null, null),
  ('people', 'teamId', 'Equipe', 'MULTIPLE_OPTIONS', 'r.owner_id', 'teams', 'fgs', null, null),
  ('people', 'name', 'Nome', 'TEXT', 'r.full_name', null, 'fgsc', null, null),
  ('people', 'label', 'Etiqueta', 'MULTIPLE_OPTIONS', 'r.id', 'labels', 'fgsc', null, null),
  ('people', 'orgId', 'Organização', 'ORGANIZATION', 'r.organization_id', 'orgs', 'fgsc', null, null),
  ('people', 'jobTitle', 'Cargo', 'TEXT', 'r.job_title', null, 'fgsc', null, null),
  ('people', 'email', 'E-mail', 'TEXT', '(select string_agg(em->>''value'', '', '') from jsonb_array_elements(r.emails) em)', null, 'fc', null, null),
  ('people', 'phone', 'Telefone', 'TEXT', '(select string_agg(ph->>''value'', '', '') from jsonb_array_elements(r.phones) ph)', null, 'fc', null, null),
  ('people', 'addTime', 'Pessoa criada', 'DATE_TIME', 'r.created_at', null, 'fgc', null, null),
  ('people', 'updateTime', 'Atualizar tempo', 'DATE_TIME', 'r.updated_at', null, 'fgc', null, null),
  ('people', 'lastActivityDate', 'Data da última atividade', 'DATE',
   '(select max((a.completed_at at time zone ''America/Sao_Paulo'')::date) from public.activities a where a.person_id = r.id and a.done and a.deleted_at is null)',
   null, 'fgc', null, null),
  ('people', 'nextActivityDate', 'Data da próxima atividade', 'DATE',
   '(select min((a.due_at at time zone ''America/Sao_Paulo'')::date) from public.activities a where a.person_id = r.id and not a.done and a.deleted_at is null)',
   null, 'fgc', null, null),
  ('people', 'activitiesCount', 'Número de atividades', 'NUMERICAL',
   'nullif((select count(*) from public.activities a where a.person_id = r.id and a.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('people', 'activitiesToDo', 'Número de atividades por fazer', 'NUMERICAL',
   'nullif((select count(*) from public.activities a where a.person_id = r.id and not a.done and a.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('people', 'doneActivitiesCount', 'Número de atividades concluídas', 'NUMERICAL',
   'nullif((select count(*) from public.activities a where a.person_id = r.id and a.done and a.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('people', 'closedDealsCount', 'Número de negócios fechados', 'NUMERICAL',
   'nullif((select count(*) from public.deals dd where dd.person_id = r.id and dd.status in (''won'', ''lost'') and dd.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('people', 'lostDealsCount', 'Número de negócios perdidos', 'NUMERICAL',
   'nullif((select count(*) from public.deals dd where dd.person_id = r.id and dd.status = ''lost'' and dd.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('people', 'openDealsCount', 'Número de negócios abertos', 'NUMERICAL',
   'nullif((select count(*) from public.deals dd where dd.person_id = r.id and dd.status = ''open'' and dd.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('people', 'wonDealsCount', 'Número de negócios ganhos', 'NUMERICAL',
   'nullif((select count(*) from public.deals dd where dd.person_id = r.id and dd.status = ''won'' and dd.deleted_at is null), 0)', null, 'fmc', 'sum', null),
  ('people', 'notesCount', 'Número de anotações', 'NUMERICAL',
   'nullif((select count(*) from public.notes nn where nn.entity = ''persons'' and nn.record_id = r.id and nn.deleted_at is null), 0)', null, 'fmc', 'sum', null)
  ) v(dtype, id, name, ftype, expr, opts, roles, agg, rts);
$f$;

-- Tipos de relatório por entidade e gráficos aceitos (o primeiro é o padrão).
create or replace function public.insights_report_types()
returns table (dtype text, rt text, charts text[], def_group text, def_measure text)
language sql immutable set search_path = public, pg_temp as $$
  select * from (values
    ('deals', 'stats', array['column', 'bar', 'pie', 'scorecard', 'table'], 'addTime', 'count'),
    ('deals', 'conversion_overall', array['column', 'bar', 'scorecard', 'table'], 'userId', 'count'),
    ('deals', 'funnel_conversion', array['funnel', 'table'], 'funnelStage', 'count'),
    ('deals', 'duration', array['column', 'bar', 'scorecard', 'table'], 'dealStageLogStageId', 'duration'),
    ('deals', 'progress', array['column', 'bar', 'table'], 'dealStageLogAddTime', 'count'),
    ('deals', 'product_performance', array['column', 'bar', 'pie', 'scorecard', 'table'], 'dealProductsProductId', 'dealProductsSum'),
    ('deals', 'revenue_forecast', array['column', 'bar', 'scorecard', 'table'], 'expectedCloseDateOrWonTime', 'value'),
    ('leads', 'performance', array['column', 'bar', 'pie', 'scorecard', 'table'], 'addTime', 'count'),
    ('leads', 'conversion', array['column', 'bar', 'scorecard', 'table'], 'userId', 'count'),
    ('activities', 'performance', array['column', 'bar', 'pie', 'scorecard', 'table'], 'markedAsDoneTime', 'count'),
    ('organizations', 'performance', array['column', 'bar', 'pie', 'scorecard', 'table'], 'addTime', 'count'),
    ('people', 'performance', array['column', 'bar', 'pie', 'scorecard', 'table'], 'addTime', 'count')
  ) v(dtype, rt, charts, def_group, def_measure);
$$;

create or replace function public.insights_table(p_dtype text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_dtype when 'people' then 'persons' else p_dtype end;
$$;

-- Ligação com outra entidade pelo prefixo do campo. direct: no máximo um registro ligado.
create or replace function public.insights_link(p_dtype text, p_prefix text, out target text, out cond text, out direct boolean)
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  case p_dtype || ':' || p_prefix
    when 'activities:deal_id_' then target := 'deals'; cond := 'x.id = r.deal_id'; direct := true;
    when 'activities:lead_id_' then target := 'leads'; cond := 'x.id = r.lead_id'; direct := true;
    when 'activities:person_id_' then target := 'people'; cond := 'x.id = r.person_id'; direct := true;
    when 'activities:org_id_' then target := 'organizations'; cond := 'x.id = r.organization_id'; direct := true;
    when 'deals:lead_id_' then target := 'leads'; cond := 'x.id = r.lead_id'; direct := true;
    when 'deals:person_id_' then target := 'people'; cond := 'x.id = r.person_id'; direct := true;
    when 'deals:org_id_' then target := 'organizations'; cond := 'x.id = r.organization_id'; direct := true;
    when 'deals:activity_id_' then target := 'activities'; cond := 'x.deal_id = r.id'; direct := false;
    when 'leads:deal_id_' then target := 'deals'; cond := 'x.id = r.converted_deal_id'; direct := true;
    when 'leads:person_id_' then target := 'people'; cond := 'x.id = r.person_id'; direct := true;
    when 'leads:org_id_' then target := 'organizations'; cond := 'x.id = r.organization_id'; direct := true;
    when 'leads:activity_id_' then target := 'activities'; cond := 'x.lead_id = r.id'; direct := false;
    when 'organizations:lead_id_' then target := 'leads'; cond := 'x.organization_id = r.id'; direct := false;
    when 'organizations:deal_id_' then target := 'deals'; cond := 'x.organization_id = r.id'; direct := false;
    when 'organizations:person_id_' then target := 'people'; cond := 'x.organization_id = r.id'; direct := false;
    when 'organizations:activity_id_' then target := 'activities'; cond := 'x.organization_id = r.id'; direct := false;
    when 'people:lead_id_' then target := 'leads'; cond := 'x.person_id = r.id'; direct := false;
    when 'people:deal_id_' then target := 'deals'; cond := 'x.person_id = r.id'; direct := false;
    when 'people:org_id_' then target := 'organizations'; cond := 'x.id = r.organization_id'; direct := true;
    when 'people:activity_id_' then target := 'activities'; cond := 'x.person_id = r.id'; direct := false;
    else null;
  end case;
end $$;

-- 3. Resolução de campo -------------------------------------------------------------------------------------------
-- special: label:<entidade>, team, multi (personalizado de múltipla escolha), product. tmpl: exists do campo ligado
-- com {c} no lugar da condição; sub: subconsulta para mostrar o valor ligado numa coluna (só ligação direta).
create or replace function public.insights_field(p_company uuid, p_dtype text, p_rt text, p_id text,
  out id text, out name text, out ftype text, out expr text, out opts text, out roles text, out agg text,
  out special text, out tmpl text, out sub text)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_prefix text;
  v_link record;
  v_t record;
  v_cf record;
begin
  if p_id is null or p_id = '' then
    return;
  end if;
  -- ligado
  v_prefix := substring(p_id from '^(deal_id_|lead_id_|person_id_|org_id_|activity_id_)');
  if v_prefix is not null then
    select * into v_link from public.insights_link(p_dtype, v_prefix);
    if v_link.target is null then
      return;
    end if;
    select * into v_t from public.insights_field(p_company, v_link.target, null, substr(p_id, length(v_prefix) + 1));
    if v_t.id is null or v_t.tmpl is not null or position('f' in v_t.roles) = 0 then
      return;
    end if;
    id := p_id; name := v_t.name; ftype := v_t.ftype; opts := v_t.opts; agg := null;
    expr := regexp_replace(v_t.expr, '\mr\.', 'x.', 'g');
    special := v_t.special;
    roles := 'f' || case when v_link.direct then 'c' else '' end;
    tmpl := format('exists (select 1 from public.%I x where %s and x.deleted_at is null and {c})',
      public.insights_table(v_link.target), v_link.cond);
    if v_link.direct then
      sub := format('(select {e} from public.%I x where %s and x.deleted_at is null)',
        public.insights_table(v_link.target), v_link.cond);
    end if;
    return;
  end if;
  -- nativo (o específico do tipo de relatório vence)
  select f.id, f.name, f.ftype, f.expr, f.opts, f.roles, f.agg into id, name, ftype, expr, opts, roles, agg
  from public.insights_native_fields() f
  where f.dtype = p_dtype and f.id = p_id
    and (f.rts is null or (p_rt is not null and p_rt = any (string_to_array(f.rts, ','))))
  order by (f.rts is null) limit 1;
  if id is not null then
    special := case when p_id = 'label' then 'label:' || public.insights_table(p_dtype)
      when p_id = 'teamId' then 'team'
      when p_id = 'dealProductsProductId' and expr = 'r.id' then 'product' end;
    return;
  end if;
  -- personalizado (chave do campo na empresa)
  if p_id !~ '^[a-z][a-z0-9_]{0,39}$' or p_dtype = 'activities' then
    return;
  end if;
  select cf.key, cf.label, cf.type, cf.options into v_cf from public.custom_field_defs cf
  where cf.company_id = p_company and cf.entity = public.insights_table(p_dtype) and cf.key = p_id
    and cf.archived_at is null;
  if v_cf.key is null then
    return;
  end if;
  id := p_id; name := v_cf.label;
  case v_cf.type
    when 'text' then ftype := 'TEXT'; roles := 'fgsc';
      expr := format('nullif(r.custom_fields->>%L, '''')', p_id);
    when 'number', 'money' then ftype := case v_cf.type when 'money' then 'MONETARY' else 'NUMERICAL' end;
      roles := 'fmc'; agg := 'sum';
      expr := format('(case when (r.custom_fields->>%1$L) ~ ''^-?[0-9]+(\.[0-9]+)?$'' then (r.custom_fields->>%1$L)::numeric end)', p_id);
    when 'date' then ftype := 'DATE'; roles := 'fgc';
      expr := format('(case when (r.custom_fields->>%1$L) ~ ''^\d{4}-\d{2}-\d{2}'' then left(r.custom_fields->>%1$L, 10)::date end)', p_id);
    when 'select' then ftype := 'SINGLE_OPTION'; roles := 'fgsc';
      expr := format('nullif(r.custom_fields->>%L, '''')', p_id);
      opts := (select jsonb_agg(jsonb_build_array(o, o))::text from jsonb_array_elements_text(v_cf.options) o);
    when 'multiselect' then ftype := 'MULTIPLE_OPTIONS'; roles := 'fgsc'; special := 'multi';
      expr := format('r.custom_fields->%L', p_id);
      opts := (select jsonb_agg(jsonb_build_array(o, o))::text from jsonb_array_elements_text(v_cf.options) o);
    when 'user' then ftype := 'USER'; roles := 'fgsc'; opts := 'users';
      expr := format('(case when (r.custom_fields->>%1$L) ~ ''^[0-9a-f-]{36}$'' then (r.custom_fields->>%1$L)::uuid end)', p_id);
    else id := null;
  end case;
end $$;

-- Rótulo de exibição de um valor (e) pela fonte das opções.
create or replace function public.insights_disp(p_opts text, p_ftype text, p_e text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_case text := '';
  o jsonb;
begin
  if p_opts is not null and left(p_opts, 1) = '[' then
    for o in select x from jsonb_array_elements(p_opts::jsonb) x loop
      v_case := v_case || format(' when %L then %L', o->>0, o->>1);
    end loop;
    return format('(case (%s)::text%s else (%s)::text end)', p_e, v_case, p_e);
  end if;
  return case p_opts
    when 'users' then format('(select coalesce(nullif(pf.full_name, ''''), pf.email) from public.profiles pf where pf.id = (%s))', p_e)
    when 'orgs' then format('(select og.name from public.organizations og where og.id = (%s))', p_e)
    when 'persons' then format('(select ps.full_name from public.persons ps where ps.id = (%s))', p_e)
    when 'deals' then format('(select dl.title from public.deals dl where dl.id = (%s))', p_e)
    when 'leads' then format('(select ld.title from public.leads ld where ld.id = (%s))', p_e)
    when 'stages' then format('(select sg.name from public.stages sg where sg.id = (%s))', p_e)
    when 'pipelines' then format('(select pl.name from public.pipelines pl where pl.id = (%s))', p_e)
    when 'lost_reasons' then format('(select lr.name from public.lost_reasons lr where lr.id = (%s))', p_e)
    when 'disq_reasons' then format('(select dr.name from public.disqualification_reasons dr where dr.id = (%s))', p_e)
    when 'channels' then format('(select ls.name from public.lead_sources ls where ls.id = (%s))', p_e)
    when 'outcomes' then format('(select ao.name from public.activity_outcomes ao where ao.id = (%s))', p_e)
    when 'products' then format('(select pr.name from public.products pr where pr.id = (%s))', p_e)
    when 'acttypes' then format('(select at2.name from public.activity_types at2 where at2.id = (%s))', p_e)
    when 'actchannels' then format('(select ac.name from public.activity_channels ac where ac.id = (%s))', p_e)
    when 'kinds' then format('coalesce((select at3.name from public.activity_types at3 where at3.id = (%1$s)), '
      '(select ac3.name from public.activity_channels ac3 where ac3.id = (%1$s)))', p_e)
    when 'teams' then format('(select tm2.name from public.teams tm2 where tm2.id = (%s))', p_e)
    else case when p_ftype = 'BOOLEAN' then format('(case when (%1$s) then ''Sim'' when not (%1$s) then ''Não'' end)', p_e)
              else format('(%s)::text', p_e) end
  end;
end $$;

-- Ordem natural de um valor (etapas pela posição; opções fixas pela lista); null = pelo total.
create or replace function public.insights_order(p_opts text, p_e text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_case text := '';
  o jsonb;
  n int := 0;
begin
  if p_opts is not null and left(p_opts, 1) = '[' then
    for o in select x from jsonb_array_elements(p_opts::jsonb) x loop
      n := n + 1;
      v_case := v_case || format(' when %L then %s', o->>0, n);
    end loop;
    return format('(case (%s)::text%s end)', p_e, v_case);
  elsif p_opts = 'stages' then
    return format('(select pl.position * 1000 + sg.position from public.stages sg join public.pipelines pl on pl.id = sg.pipeline_id where sg.id = (%s))', p_e);
  elsif p_opts in ('channels', 'outcomes', 'acttypes', 'actchannels', 'lost_reasons', 'pipelines') then
    return null;
  end if;
  return null;
end $$;

-- 4. Filtros -----------------------------------------------------------------------------------------------------
create or replace function public.insights_is_date(p_ftype text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_ftype in ('DATE', 'DATE_TIME');
$$;

create or replace function public.insights_sp_date(p_ftype text, p_e text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when p_ftype = 'DATE_TIME' then format('((%s) at time zone ''America/Sao_Paulo'')::date', p_e)
    else format('(%s)::date', p_e) end;
$$;

-- Operando j do filtro i: $1->'f'->i->'o'->j->'defaultValue'.
create or replace function public.insights_operand(p_i int, p_j int) returns text
language sql immutable set search_path = public, pg_temp as $$
  select format('($1->''f''->%s->''o''->%s->''defaultValue'')', p_i, p_j);
$$;

-- Limites de um filtro de data já com período (back = quantos períodos voltar).
create or replace function public.insights_filter_bounds(p_filter jsonb, p_back int, out d_from date, out d_to date)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_from date;
  v_to date;
  o jsonb;
begin
  for o in select x from jsonb_array_elements(coalesce(p_filter->'operands', '[]'::jsonb)) x loop
    begin
      if o->>'name' = 'isMoreThan' then v_from := left(o->>'defaultValue', 10)::date; end if;
      if o->>'name' = 'isLessThan' then v_to := left(o->>'defaultValue', 10)::date; end if;
    exception when others then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'filter_by';
    end;
  end loop;
  select b.d_from, b.d_to into d_from, d_to
  from public.insights_period_bounds(coalesce(p_filter->>'period', 'custom'), p_back, v_from, v_to) b;
  if p_filter->>'period' is not null and p_filter->>'period' <> 'custom' and d_from is null then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'period';
  end if;
end $$;

-- Condição SQL de um filtro. p_back: períodos para trás (comparação).
create or replace function public.insights_filter_sql(p_company uuid, p_dtype text, p_rt text, p_filter jsonb, p_i int, p_back int)
returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare
  f record;
  v_op text;
  v_ops jsonb := coalesce(p_filter->'operands', '[]'::jsonb);
  v_j int;
  v_val text;
  v_arr text;
  v_l text;
  v_c text;
  v_parts text[] := '{}';
  v_b record;
  v_txt boolean;
  o jsonb;
begin
  select * into f from public.insights_field(p_company, p_dtype, p_rt, p_filter->>'filter');
  if f.id is null or position('f' in f.roles) = 0 then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filter_by';
  end if;
  if jsonb_typeof(v_ops) <> 'array' or jsonb_array_length(v_ops) > 10 then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filter_by';
  end if;

  -- data com período: intervalo calculado (literais), como o Pipedrive
  if public.insights_is_date(f.ftype) and p_filter->>'period' is not null then
    select * into v_b from public.insights_filter_bounds(p_filter, p_back);
    v_l := public.insights_sp_date(f.ftype, f.expr);
    v_c := case
      when v_b.d_from is not null and v_b.d_to is not null then format('%s between %L::date and %L::date', v_l, v_b.d_from, v_b.d_to)
      when v_b.d_from is not null then format('%s >= %L::date', v_l, v_b.d_from)
      when v_b.d_to is not null then format('%s <= %L::date', v_l, v_b.d_to)
      else 'true' end;
    return case when f.tmpl is not null then replace(f.tmpl, '{c}', v_c) else v_c end;
  end if;

  v_j := 0;
  for o in select x from jsonb_array_elements(v_ops) x loop
    v_op := o->>'name';
    if v_op = 'format' then
      v_j := v_j + 1;
      continue;
    end if;
    v_val := public.insights_operand(p_i, v_j);
    v_arr := format('array(select jsonb_array_elements_text(case jsonb_typeof(%1$s) when ''array'' then %1$s else jsonb_build_array(%1$s) end))', v_val);
    v_txt := f.ftype not in ('BOOLEAN', 'NUMERICAL', 'MONETARY', 'DATE', 'DATE_TIME');

    if f.special like 'label:%' then
      v_c := format('exists (select 1 from public.record_labels rl where rl.entity = %L and rl.record_id = %s%s)',
        substr(f.special, 7), f.expr, case when v_op in ('isEmpty', 'isNotEmpty') then '' else ' and rl.label_id::text = any (' || v_arr || ')' end);
      v_c := case v_op when 'isExactly' then v_c when 'isAnyOf' then v_c when 'isNotEmpty' then v_c
        when 'isNot' then 'not ' || v_c when 'isNotAnyOf' then 'not ' || v_c when 'isEmpty' then 'not ' || v_c end;
    elsif f.special = 'team' then
      v_c := format('exists (select 1 from public.team_members tm where tm.user_id = %s%s)',
        f.expr, case when v_op in ('isEmpty', 'isNotEmpty') then '' else ' and tm.team_id::text = any (' || v_arr || ')' end);
      v_c := case v_op when 'isExactly' then v_c when 'isAnyOf' then v_c when 'isNotEmpty' then v_c
        when 'isNot' then 'not ' || v_c when 'isNotAnyOf' then 'not ' || v_c when 'isEmpty' then 'not ' || v_c end;
    elsif f.special = 'product' then
      v_c := format('exists (select 1 from public.deal_items di2 where di2.deal_id = %s%s)',
        f.expr, case when v_op in ('isEmpty', 'isNotEmpty') then '' else ' and di2.product_id::text = any (' || v_arr || ')' end);
      v_c := case v_op when 'isExactly' then v_c when 'isAnyOf' then v_c when 'isNotEmpty' then v_c
        when 'isNot' then 'not ' || v_c when 'isNotAnyOf' then 'not ' || v_c when 'isExcluding' then 'not ' || v_c
        when 'isEmpty' then 'not ' || v_c end;
    elsif f.special = 'multi' then
      v_l := format('(case when jsonb_typeof(%1$s) = ''array'' then %1$s else ''[]''::jsonb end)', f.expr);
      v_c := case v_op
        when 'isExactly' then format('%s ?| %s', v_l, v_arr)
        when 'isAnyOf' then format('%s ?| %s', v_l, v_arr)
        when 'isNot' then format('not (%s ?| %s)', v_l, v_arr)
        when 'isNotAnyOf' then format('not (%s ?| %s)', v_l, v_arr)
        when 'isEmpty' then format('jsonb_array_length(%s) = 0', v_l)
        when 'isNotEmpty' then format('jsonb_array_length(%s) > 0', v_l) end;
    elsif v_txt then
      v_l := format('(%s)::text', f.expr);
      v_c := case v_op
        when 'isExactly' then format('%s = (%s #>> ''{}'')', v_l, v_val)
        when 'isNot' then format('(%1$s is null or %1$s <> (%2$s #>> ''{}''))', v_l, v_val)
        when 'isAnyOf' then format('%s = any (%s)', v_l, v_arr)
        -- sem valor não fica fora de "não é nenhum de" (como no Pipedrive)
        when 'isNotAnyOf' then format('(%1$s is null or not (%1$s = any (%2$s)))', v_l, v_arr)
        when 'isEmpty' then format('(%1$s is null or %1$s = '''')', v_l)
        when 'isNotEmpty' then format('(%1$s is not null and %1$s <> '''')', v_l)
        when 'contains' then format('%s ilike ''%%'' || (%s #>> ''{}'') || ''%%''', v_l, v_val)
        when 'notContains' then format('(%1$s is null or %1$s not ilike ''%%'' || (%2$s #>> ''{}'') || ''%%'')', v_l, v_val)
        when 'startsWith' then format('%s ilike (%s #>> ''{}'') || ''%%''', v_l, v_val)
        when 'endsWith' then format('%s ilike ''%%'' || (%s #>> ''{}'')', v_l, v_val) end;
    elsif f.ftype = 'BOOLEAN' then
      v_l := format('(%s)::boolean', f.expr);
      v_c := case v_op
        when 'isExactly' then format('coalesce(%s, false) = (%s #>> ''{}'')::boolean', v_l, v_val)
        when 'isNot' then format('coalesce(%s, false) <> (%s #>> ''{}'')::boolean', v_l, v_val)
        when 'isEmpty' then format('%s is null', v_l)
        when 'isNotEmpty' then format('%s is not null', v_l) end;
    elsif f.ftype in ('NUMERICAL', 'MONETARY') then
      v_l := format('(%s)::numeric', f.expr);
      v_c := case v_op
        when 'isExactly' then format('%s = (%s #>> ''{}'')::numeric', v_l, v_val)
        when 'isNot' then format('%s is distinct from (%s #>> ''{}'')::numeric', v_l, v_val)
        when 'isMoreThan' then format('%s > (%s #>> ''{}'')::numeric', v_l, v_val)
        when 'isLessThan' then format('%s < (%s #>> ''{}'')::numeric', v_l, v_val)
        when 'isEmpty' then format('%s is null', v_l)
        when 'isNotEmpty' then format('%s is not null', v_l) end;
    else
      v_l := public.insights_sp_date(f.ftype, f.expr);
      v_c := case v_op
        when 'isMoreThan' then format('%s >= left(%s #>> ''{}'', 10)::date', v_l, v_val)
        when 'isLessThan' then format('%s <= left(%s #>> ''{}'', 10)::date', v_l, v_val)
        when 'isEmpty' then format('%s is null', v_l)
        when 'isNotEmpty' then format('%s is not null', v_l) end;
    end if;
    if v_c is null then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'operator';
    end if;
    v_parts := v_parts || v_c;
    v_j := v_j + 1;
  end loop;
  if cardinality(v_parts) = 0 then
    return 'true';
  end if;
  v_c := '(' || array_to_string(v_parts, ' and ') || ')';
  return case when f.tmpl is not null then replace(f.tmpl, '{c}', v_c) else v_c end;
end $$;

-- 5. Dimensões e medidas ---------------------------------------------------------------------------------------------
-- k: chave (texto), l: rótulo, o: ordem natural, j: join lateral (campos de várias opções).
create or replace function public.insights_dim(p_company uuid, p_dtype text, p_rt text, p_id text, p_interval text, p_sfx text,
  out k text, out l text, out o text, out j text, out is_date boolean, out ftype text, out name text, out opts text)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  f record;
  g text := 'g' || p_sfx;
  d text;
begin
  if p_interval is null or p_interval not in ('day', 'week', 'month', 'quarter', 'year') then
    p_interval := 'month';
  end if;
  select * into f from public.insights_field(p_company, p_dtype, p_rt, p_id);
  if f.id is null or (position('g' in f.roles) = 0 and position('s' in f.roles) = 0) or f.tmpl is not null then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'group_by';
  end if;
  ftype := f.ftype; name := f.name; opts := f.opts; j := '';
  is_date := public.insights_is_date(f.ftype);
  if is_date then
    d := public.insights_sp_date(f.ftype, f.expr);
    k := case coalesce(nullif(p_interval, ''), 'month')
      when 'day' then format('to_char(%s, ''YYYY-MM-DD'')', d)
      when 'week' then format('to_char(date_trunc(''week'', %s + 1)::date - 1, ''YYYY-MM-DD'')', d)
      when 'month' then format('to_char(date_trunc(''month'', %s), ''YYYY-MM-DD'')', d)
      when 'quarter' then format('to_char(date_trunc(''quarter'', %s), ''YYYY-MM-DD'')', d)
      when 'year' then format('to_char(date_trunc(''year'', %s), ''YYYY-MM-DD'')', d)
    end;
    if k is null then
      raise exception 'OXYN_INVALID_REPORT' using detail = 'interval';
    end if;
    l := k; o := k;
  elsif f.special like 'label:%' then
    j := format(' left join lateral (select lb.id::text as k, lb.name as l from public.record_labels rl '
      'join public.labels lb on lb.id = rl.label_id where rl.entity = %L and rl.record_id = %s) %I on true',
      substr(f.special, 7), f.expr, g);
    k := format('%I.k', g); l := format('%I.l', g); o := null;
  elsif f.special = 'team' then
    j := format(' left join lateral (select t.id::text as k, t.name as l from public.team_members tm '
      'join public.teams t on t.id = tm.team_id where tm.user_id = %s) %I on true', f.expr, g);
    k := format('%I.k', g); l := format('%I.l', g); o := null;
  elsif f.special = 'multi' then
    j := format(' left join lateral (select v as k, v as l from jsonb_array_elements_text(case when jsonb_typeof(%s) = ''array'' '
      'then %s else ''[]''::jsonb end) v) %I on true', f.expr, f.expr, g);
    k := format('%I.k', g); l := format('%I.l', g); o := public.insights_order(f.opts, format('%I.k', g));
  else
    k := format('(%s)::text', f.expr);
    l := public.insights_disp(f.opts, f.ftype, f.expr);
    o := public.insights_order(f.opts, f.expr);
  end if;
end $$;

-- Agregado da medida sobre a coluna m da base. mtype: number, currency, days.
create or replace function public.insights_measure(p_company uuid, p_dtype text, p_rt text, p_measure text, p_agg text,
  out m text, out agg text, out label text, out mtype text)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  f record;
  v_agg text;
begin
  if coalesce(p_measure, 'count') = 'count' then
    m := '1';
    agg := 'count(*)';
    label := case p_dtype when 'deals' then 'Número de negócios' when 'leads' then 'Número de leads'
      when 'activities' then 'Número de atividades' when 'organizations' then 'Número de organizações'
      else 'Número de pessoas' end;
    if p_rt = 'product_performance' then label := 'Número de produtos'; end if;
    mtype := 'number';
    return;
  end if;
  select * into f from public.insights_field(p_company, p_dtype, p_rt, p_measure);
  if f.id is null or position('m' in f.roles) = 0 or f.tmpl is not null then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'measure_by';
  end if;
  v_agg := coalesce(nullif(p_agg, ''), f.agg, 'sum');
  if v_agg not in ('sum', 'avg', 'min', 'max') then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'measure_by_aggregation';
  end if;
  m := format('(%s)::numeric', f.expr);
  agg := v_agg || '(m)';
  label := f.name;
  mtype := case when f.ftype = 'MONETARY' then 'currency' when p_measure in ('duration', 'totalDuration', 'timeToConvert', 'totalTimeToConvert') then 'days' else 'number' end;
end $$;

-- 6. Montagem -------------------------------------------------------------------------------------------------------
-- Aplica os filtros rápidos do painel: período (só nos filtros de data com período), usuário e funil.
create or replace function public.insights_apply_overrides(p_company uuid, p_dtype text, p_rt text, p_filters jsonb, p_over jsonb)
returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_owner text := case when p_dtype in ('organizations', 'people') then 'ownerId' else 'userId' end;
  v_p jsonb := p_over->'period';
  v_users jsonb := p_over->'user_ids';
  v_pipe text := p_over->>'pipeline_id';
  f jsonb;
  v_t text;
begin
  for f in select x from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) x loop
    if jsonb_typeof(v_users) = 'array' and jsonb_array_length(v_users) > 0 and f->>'filter' = v_owner then
      continue;
    end if;
    if v_pipe is not null and p_dtype = 'deals' and f->>'filter' = 'pipelineId' then
      continue;
    end if;
    if jsonb_typeof(v_p) = 'object' and f->>'period' is not null then
      select ftype into v_t from public.insights_field(p_company, p_dtype, p_rt, f->>'filter');
      if public.insights_is_date(v_t) then
        f := f || jsonb_build_object('period', v_p->>'period', 'operands',
          case when v_p->>'period' = 'custom' then jsonb_build_array(
            jsonb_build_object('name', 'isMoreThan', 'defaultValue', v_p->>'from'),
            jsonb_build_object('name', 'isLessThan', 'defaultValue', v_p->>'to')) else '[]'::jsonb end);
      end if;
    end if;
    v_out := v_out || jsonb_build_array(f);
  end loop;
  if jsonb_typeof(v_users) = 'array' and jsonb_array_length(v_users) > 0 then
    v_out := v_out || jsonb_build_array(jsonb_build_object('filter', v_owner, 'type', 'USER',
      'operands', jsonb_build_array(jsonb_build_object('name', 'isAnyOf', 'defaultValue', v_users)), 'period', null));
  end if;
  if v_pipe is not null and p_dtype = 'deals' then
    v_out := v_out || jsonb_build_array(jsonb_build_object('filter', 'pipelineId', 'type', 'ID',
      'operands', jsonb_build_array(jsonb_build_object('name', 'isExactly', 'defaultValue', v_pipe)), 'period', null));
  end if;
  return v_out;
end $$;

-- Valida a combinação entidade/tipo/gráfico e devolve os parâmetros normalizados.
create or replace function public.insights_check(p_def jsonb) returns void
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_charts text[];
begin
  if p_def is null or jsonb_typeof(p_def) <> 'object' then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'definition';
  end if;
  select t.charts into v_charts from public.insights_report_types() t
  where t.dtype = p_def->>'data_type' and t.rt = p_def->>'report_type';
  if v_charts is null then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'report_type';
  end if;
  if not (p_def->>'chart_type' = any (v_charts)) then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'chart_type';
  end if;
  if coalesce(jsonb_typeof(p_def#>'{parameters,filter_by}'), 'array') <> 'array'
     or jsonb_array_length(coalesce(p_def#>'{parameters,filter_by}', '[]'::jsonb)) > 30 then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'filter_by';
  end if;
  if coalesce(jsonb_typeof(p_def->'columns'), 'array') <> 'array' or jsonb_array_length(coalesce(p_def->'columns', '[]'::jsonb)) > 30 then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'columns';
  end if;
end $$;

-- FROM e WHERE do relatório (com a visibilidade). p_back: períodos para trás.
create or replace function public.insights_from_where(p_company uuid, p_dtype text, p_rt text, p_filters jsonb, p_back int,
  out v_from text, out v_where text)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  f jsonb;
  i int := 0;
begin
  v_from := case
    when p_dtype = 'deals' and p_rt = 'progress' then
      'public.deal_stage_history h0 join public.deals r on r.id = h0.deal_id '
      'cross join lateral (select h0.to_stage_id as stage_id, h0.moved_at) h'
    when p_dtype = 'deals' and p_rt = 'duration' then
      '(select hh.deal_id, hh.to_stage_id as stage_id, sum(extract(epoch from (coalesce(hh.next_at, d2.won_at, d2.lost_at, now()) - hh.moved_at))) / 86400.0 as days '
      ' from (select h1.*, lead(h1.moved_at) over (partition by h1.deal_id order by h1.moved_at, h1.id) as next_at from public.deal_stage_history h1) hh '
      ' join public.deals d2 on d2.id = hh.deal_id group by hh.deal_id, hh.to_stage_id) h join public.deals r on r.id = h.deal_id'
    when p_dtype = 'deals' and p_rt = 'product_performance' then
      'public.deal_items i join public.deals r on r.id = i.deal_id'
    else format('public.%I r', public.insights_table(p_dtype))
  end || ' join vis on vis.company_id = r.company_id and vis.owner_id = r.owner_id';
  v_where := 'r.deleted_at is null and r.company_id = $2';
  if p_rt = 'revenue_forecast' then
    v_where := v_where || ' and r.status in (''open'', ''won'')';
  elsif p_rt = 'conversion_overall' then
    v_where := v_where || ' and r.status in (''won'', ''lost'')';
  end if;
  for f in select x from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) x loop
    v_where := v_where || ' and ' || public.insights_filter_sql(p_company, p_dtype, p_rt, f, i, p_back);
    i := i + 1;
  end loop;
end $$;

create or replace function public.insights_vis(p_dtype text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select format('select c.company_id, c.owner_id from (select distinct t.company_id, t.owner_id from public.%1$I t '
    'where t.company_id = $2 and t.deleted_at is null) c '
    'where public.can_access_for($3, c.company_id, %2$L, c.owner_id, ''read'')',
    public.insights_table(p_dtype), public.insights_table(p_dtype));
$$;

-- 7. Execução -------------------------------------------------------------------------------------------------------
create or replace function public.insights_exec(p_company uuid, p_def jsonb, p_viewer uuid, p_over jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_dtype text := p_def->>'data_type';
  v_rt text := p_def->>'report_type';
  v_chart text := p_def->>'chart_type';
  P jsonb := coalesce(p_def->'parameters', '{}'::jsonb);
  v_over jsonb := coalesce(nullif(p_over, 'null'::jsonb), '{}'::jsonb);
  v_filters jsonb;
  v_params jsonb;
  v_fw record;
  v_met record;
  v_x record;
  v_s record;
  v_group text;
  v_seg text;
  v_vis text;
  v_total jsonb;
  v_prev jsonb;
  v_res jsonb;
  v_cmp jsonb;
  v_has_period boolean;
  v_range record;
  v_cmp_filters jsonb;
begin
  perform public.insights_check(p_def);
  v_filters := public.insights_apply_overrides(p_company, v_dtype, v_rt, P->'filter_by', v_over);
  v_params := jsonb_build_object('f', (select coalesce(jsonb_agg(f || jsonb_build_object('o', coalesce(f->'operands', '[]'::jsonb))), '[]'::jsonb)
    from jsonb_array_elements(v_filters) f));
  v_vis := public.insights_vis(v_dtype);

  if v_rt = 'funnel_conversion' then
    return public.insights_exec_funnel(p_company, p_def, p_viewer, v_filters, v_params);
  end if;

  select * into v_met from public.insights_measure(p_company, v_dtype, v_rt, P->>'measure_by', P->>'measure_by_aggregation');
  select * into v_fw from public.insights_from_where(p_company, v_dtype, v_rt, v_filters, 0);

  -- total (sem joins de dimensão)
  execute format('with vis as materialized (%s) select to_jsonb(%s) from (select %s as m from %s where %s) b',
    v_vis, v_met.agg, v_met.m, v_fw.v_from, v_fw.v_where) into v_total using v_params, p_company, p_viewer;

  v_has_period := exists (select 1 from jsonb_array_elements(v_filters) f
    where f->>'period' is not null and public.insights_is_date((public.insights_field(p_company, v_dtype, v_rt, f->>'filter')).ftype));

  -- cartão de número: total do período anterior
  if v_chart = 'scorecard' then
    if v_has_period then
      select * into v_range from public.insights_from_where(p_company, v_dtype, v_rt, v_filters, 1);
      execute format('with vis as materialized (%s) select to_jsonb(%s) from (select %s as m from %s where %s) b',
        v_vis, v_met.agg, v_met.m, v_range.v_from, v_range.v_where) into v_prev using v_params, p_company, p_viewer;
    end if;
    return jsonb_build_object('total', coalesce(v_total, '0'::jsonb), 'previous', v_prev,
      'measure', jsonb_build_object('id', coalesce(P->>'measure_by', 'count'), 'label', v_met.label, 'type', v_met.mtype),
      'x', '[]'::jsonb, 'segments', '[]'::jsonb, 'values', '[]'::jsonb);
  end if;

  v_group := coalesce(nullif(P#>>'{group_by,filter}', ''),
    (select t.def_group from public.insights_report_types() t where t.dtype = v_dtype and t.rt = v_rt));
  v_seg := nullif(nullif(P->>'segment_by', ''), 'none');
  if v_rt = 'conversion_overall' then v_seg := 'status'; end if;

  v_res := public.insights_grouped(p_company, v_dtype, v_rt, v_group, P#>>'{group_by,interval}', v_seg,
    v_filters, 0, v_met.m, v_met.agg, v_params, p_viewer);

  -- comparação: período anterior ou personalizado
  if jsonb_typeof(v_over->'compare') = 'object' and v_has_period then
    if v_over#>>'{compare,kind}' = 'custom' then
      v_cmp_filters := public.insights_apply_overrides(p_company, v_dtype, v_rt, v_filters,
        jsonb_build_object('period', jsonb_build_object('period', 'custom', 'from', v_over#>>'{compare,from}', 'to', v_over#>>'{compare,to}')));
      v_cmp := public.insights_grouped(p_company, v_dtype, v_rt, v_group, P#>>'{group_by,interval}', v_seg,
        v_cmp_filters, 0, v_met.m, v_met.agg,
        jsonb_build_object('f', (select coalesce(jsonb_agg(f || jsonb_build_object('o', coalesce(f->'operands', '[]'::jsonb))), '[]'::jsonb)
          from jsonb_array_elements(v_cmp_filters) f)), p_viewer);
    else
      v_cmp := public.insights_grouped(p_company, v_dtype, v_rt, v_group, P#>>'{group_by,interval}', v_seg,
        v_filters, 1, v_met.m, v_met.agg, v_params, p_viewer);
    end if;
  end if;

  return v_res || jsonb_build_object('total', coalesce(v_total, '0'::jsonb),
    'measure', jsonb_build_object('id', coalesce(P->>'measure_by', 'count'), 'label', v_met.label, 'type', v_met.mtype))
    || case when v_cmp is not null then jsonb_build_object('compare', v_cmp) else '{}'::jsonb end;
end $$;

-- Agrupado por x (e segmento): {x:[{key,label}], segments:[{key,label}], values:[[...]], totals:[...]}.
create or replace function public.insights_grouped(p_company uuid, p_dtype text, p_rt text, p_group text, p_interval text,
  p_seg text, p_filters jsonb, p_back int, p_m text, p_agg text, p_params jsonb, p_viewer uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_fw record;
  v_x record;
  v_s record;
  v_vis text := public.insights_vis(p_dtype);
  v_sk text := '''''';
  v_sl text := '''''';
  v_so text := 'null::text';
  v_sj text := '';
  v_fill text := '';
  v_step text;
  v_b record;
  v_from date;
  v_to date;
  v_xord text;
  v_res jsonb;
  f jsonb;
  v_ft text;
  v_s_name text;
  v_s_type text;
begin
  if p_interval is null or p_interval not in ('day', 'week', 'month', 'quarter', 'year') then
    p_interval := 'month';
  end if;
  select * into v_fw from public.insights_from_where(p_company, p_dtype, p_rt, p_filters, p_back);
  select * into v_x from public.insights_dim(p_company, p_dtype, p_rt, p_group, p_interval, 'x');
  if p_seg is not null then
    select * into v_s from public.insights_dim(p_company, p_dtype, p_rt, p_seg, 'month', 's');
    v_sk := v_s.k; v_sl := format('coalesce(%s, ''(nenhum)'')', v_s.l); v_so := coalesce(v_s.o, 'null::text'); v_sj := v_s.j;
    v_s_name := v_s.name; v_s_type := v_s.ftype;
  end if;
  if p_dtype = 'leads' and p_rt = 'conversion' then
    v_sk := '(case when r.status = ''converted'' then ''converted'' else ''other'' end)';
    v_sl := '(case when r.status = ''converted'' then ''Convertido'' else ''Não convertido'' end)';
    v_so := '(case when r.status = ''converted'' then 1 else 2 end)';
  end if;

  -- datas: preenche os intervalos vazios dentro do período do filtro do mesmo campo (ou entre o menor e o maior)
  if v_x.is_date then
    for f in select x from jsonb_array_elements(coalesce(p_filters, '[]'::jsonb)) x loop
      if f->>'filter' = p_group and f->>'period' is not null then
        select * into v_b from public.insights_filter_bounds(f, p_back);
        v_from := v_b.d_from; v_to := v_b.d_to;
      end if;
    end loop;
    v_step := case coalesce(nullif(p_interval, ''), 'month') when 'day' then '1 day' when 'week' then '1 week'
      when 'month' then '1 month' when 'quarter' then '3 months' else '1 year' end;
    v_fill := format(', bounds as (select coalesce(%s, min(nullif(k, ''''))::date) as a, coalesce(%s, max(nullif(k, ''''))::date) as b from xt), '
      'fill as (select to_char(g, ''YYYY-MM-DD'') as k from bounds, generate_series(%s, %s, %L::interval) g '
      'where bounds.a is not null and bounds.b - bounds.a < 4000), '
      'xall as (select coalesce(xt.k, fill.k) as k, coalesce(xt.l, fill.k) as l, coalesce(xt.o, fill.k) as o, coalesce(xt.t, 0) as t '
      'from fill full join xt on xt.k = fill.k where coalesce(xt.k, fill.k) <> '''')',
      case when v_from is null then 'null::date' else quote_literal(v_from) || '::date' end,
      case when v_to is null then 'null::date' else quote_literal(v_to) || '::date' end,
      case coalesce(nullif(p_interval, ''), 'month')
        when 'week' then '(date_trunc(''week'', bounds.a + 1)::date - 1)::timestamp'
        when 'day' then 'bounds.a::timestamp'
        else format('date_trunc(%L, bounds.a::timestamp)', coalesce(nullif(p_interval, ''), 'month')) end,
      'bounds.b::timestamp', v_step);
    v_xord := 'k';
  else
    v_fill := ', xall as (select k, l, o, t from xt)';
    v_xord := case when v_x.o is not null then 'o::text, k' else '(k = ''''), t desc nulls last, l, k' end;
    if v_x.o is not null then
      v_xord := '(k = ''''), case when o ~ ''^-?[0-9]+(\.[0-9]+)?$'' then o::numeric end nulls last, t desc nulls last, l, k';
    end if;
  end if;

  execute format(
    'with vis as materialized (%1$s), '
    'base as (select coalesce(%2$s, '''') as k, coalesce(%3$s, ''(nenhum)'') as l, (%4$s)::text as o, '
    '  coalesce(%5$s, '''') as sk, %6$s as sl, (%7$s)::text as so, %8$s as m from %9$s%10$s%11$s where %12$s), '
    'xt as (select k, min(l) as l, min(o) as o, %13$s as t from base group by k)%14$s, '
    'xs as (select k, l, t, row_number() over (order by %15$s) as rn from xall), '
    'segs as (select sk, min(sl) as sl, min(so) as so, row_number() over (order by case when min(so) ~ ''^-?[0-9]+(\.[0-9]+)?$'' then min(so)::numeric end nulls last, %13$s desc, min(sl)) as rn '
    '  from base group by sk), '
    'cells as (select k, sk, %13$s as v from base group by k, sk) '
    'select jsonb_build_object('
    '  ''x'', coalesce((select jsonb_agg(jsonb_build_object(''key'', k, ''label'', l) order by rn) from xs where rn <= 500), ''[]''::jsonb), '
    '  ''segments'', case when %16$s then coalesce((select jsonb_agg(jsonb_build_object(''key'', sk, ''label'', sl) order by rn) from segs), ''[]''::jsonb) else ''[]''::jsonb end, '
    '  ''values'', coalesce((select jsonb_agg((select coalesce(jsonb_agg(coalesce(c.v, 0) order by s.rn), ''[]''::jsonb) '
    '     from segs s left join cells c on c.k = x.k and c.sk = s.sk) order by x.rn) from xs x where x.rn <= 500), ''[]''::jsonb), '
    '  ''totals'', coalesce((select jsonb_agg(t order by rn) from xs where rn <= 500), ''[]''::jsonb), '
    '  ''truncated'', (select count(*) > 500 from xs), '
    '  ''x_field'', jsonb_build_object(''id'', %17$L, ''label'', %18$L, ''type'', %19$L, ''interval'', %20$L), '
    '  ''segment_field'', %21$s)',
    v_vis, v_x.k, v_x.l, coalesce(v_x.o, 'null::text'), v_sk, v_sl, v_so, p_m, v_fw.v_from, v_x.j, v_sj, v_fw.v_where,
    p_agg, v_fill, v_xord,
    case when p_seg is not null or (p_dtype = 'leads' and p_rt = 'conversion') then 'true' else 'false' end,
    p_group, v_x.name, v_x.ftype, case when v_x.is_date then coalesce(nullif(p_interval, ''), 'month') end,
    case when p_seg is not null then format('jsonb_build_object(''id'', %L, ''label'', %L, ''type'', %L)', p_seg, v_s_name, v_s_type)
      else 'null::jsonb' end)
    into v_res using p_params, p_company, p_viewer;
  return v_res;
end $$;

-- Funil de conversão: etapas escolhidas (ou as do funil), quantos chegaram a cada uma e quantos ganharam.
create or replace function public.insights_exec_funnel(p_company uuid, p_def jsonb, p_viewer uuid, p_filters jsonb, p_params jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_fw record;
  v_met record;
  v_stages uuid[];
  v_res jsonb;
  P jsonb := coalesce(p_def->'parameters', '{}'::jsonb);
begin
  select * into v_met from public.insights_measure(p_company, 'deals', 'funnel_conversion', P->>'measure_by', P->>'measure_by_aggregation');
  select * into v_fw from public.insights_from_where(p_company, 'deals', 'funnel_conversion', p_filters, 0);
  begin
    v_stages := array(select x::uuid from jsonb_array_elements_text(coalesce(P->'stages', '[]'::jsonb)) x);
  exception when others then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'stages';
  end;
  execute format(
    'with vis as materialized (%1$s), '
    'deals_f as (select r.id, r.status, r.stage_id, r.pipeline_id, %2$s as m from %3$s where %4$s), '
    'st as (select s.id, s.name, s.position, s.pipeline_id from public.stages s where s.company_id = $2 and s.archived_at is null '
    '  and (cardinality($4::uuid[]) = 0 or s.id = any ($4::uuid[])) '
    '  and (cardinality($4::uuid[]) > 0 or s.pipeline_id in (select pipeline_id from deals_f))), '
    -- maior posição alcançada pelo negócio no funil (histórico + etapa atual)
    'reach as (select d.id, d.m, d.status, d.pipeline_id, max(s.position) as maxpos from deals_f d '
    '  join public.stages s on s.id = d.stage_id or s.id in (select h.to_stage_id from public.deal_stage_history h where h.deal_id = d.id) '
    '  where s.pipeline_id = d.pipeline_id group by d.id, d.m, d.status, d.pipeline_id), '
    'rows as (select st.id, st.name, st.position, (select %5$s from reach where reach.pipeline_id = st.pipeline_id and reach.maxpos >= st.position) as v '
    '  from st), '
    'won as (select %5$s as v from reach where status = ''won'') '
    'select jsonb_build_object('
    '  ''x'', coalesce((select jsonb_agg(jsonb_build_object(''key'', id::text, ''label'', name) order by position) from rows), ''[]''::jsonb) '
    '        || jsonb_build_array(jsonb_build_object(''key'', ''won'', ''label'', ''Ganho'')), '
    '  ''segments'', jsonb_build_array(jsonb_build_object(''key'', ''reached'', ''label'', ''Chegou à etapa''), jsonb_build_object(''key'', ''won'', ''label'', ''Ganho'')), '
    '  ''values'', coalesce((select jsonb_agg(jsonb_build_array(coalesce(v, 0), 0) order by position) from rows), ''[]''::jsonb) '
    '        || jsonb_build_array(jsonb_build_array(0, coalesce((select v from won), 0))), '
    '  ''totals'', coalesce((select jsonb_agg(coalesce(v, 0) order by position) from rows), ''[]''::jsonb) || jsonb_build_array(coalesce((select v from won), 0)), '
    '  ''total'', coalesce((select v from rows order by position limit 1), 0), '
    '  ''won'', coalesce((select v from won), 0))',
    public.insights_vis('deals'), v_met.m, v_fw.v_from, v_fw.v_where, v_met.agg)
    into v_res using p_params, p_company, p_viewer, v_stages;
  return v_res || jsonb_build_object('measure', jsonb_build_object('id', coalesce(P->>'measure_by', 'count'), 'label', v_met.label, 'type', v_met.mtype),
    'x_field', jsonb_build_object('id', 'funnelStage', 'label', 'Etapa do funil', 'type', 'ID'), 'segment_field', null);
end $$;

-- 8. Lista de registros ----------------------------------------------------------------------------------------------
create or replace function public.insights_default_columns(p_dtype text) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case p_dtype
    when 'deals' then '["title","value","userId","stageId","status","addTime","expectedCloseDate"]'
    when 'leads' then '["title","userId","channel","status","addTime","orgId"]'
    when 'activities' then '["subject","type","userId","done","dueDate","orgId"]'
    when 'organizations' then '["name","ownerId","addTime"]'
    else '["name","orgId","ownerId","addTime"]' end::jsonb;
$$;

-- Expressão de uma coluna (valor já pronto para exibir) e o tipo para a tela.
create or replace function public.insights_column(p_company uuid, p_dtype text, p_id text, out expr text, out label text, out ctype text)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  f record;
  v_e text;
begin
  select * into f from public.insights_field(p_company, p_dtype, null, p_id);
  if f.id is null or position('c' in f.roles) = 0 then
    raise exception 'OXYN_INVALID_REPORT' using detail = 'columns';
  end if;
  label := f.name;
  if f.special like 'label:%' then
    v_e := format('(select string_agg(lb.name, '', '' order by lb.name) from public.record_labels rl join public.labels lb on lb.id = rl.label_id '
      'where rl.entity = %L and rl.record_id = %s)', substr(f.special, 7), f.expr);
    ctype := 'text';
  elsif f.special = 'multi' then
    v_e := format('(select string_agg(v, '', '') from jsonb_array_elements_text(case when jsonb_typeof(%1$s) = ''array'' then %1$s else ''[]''::jsonb end) v)', f.expr);
    ctype := 'text';
  elsif f.ftype in ('NUMERICAL', 'MONETARY') then
    v_e := format('(%s)::numeric', f.expr);
    ctype := case f.ftype when 'MONETARY' then 'currency' else 'number' end;
  elsif f.ftype = 'DATE_TIME' then
    v_e := format('to_char((%s) at time zone ''America/Sao_Paulo'', ''YYYY-MM-DD"T"HH24:MI'')', f.expr);
    ctype := 'datetime';
  elsif f.ftype = 'DATE' then
    v_e := format('to_char((%s)::date, ''YYYY-MM-DD'')', f.expr);
    ctype := 'date';
  else
    v_e := public.insights_disp(f.opts, f.ftype, f.expr);
    ctype := 'text';
  end if;
  expr := case when f.sub is not null then replace(f.sub, '{e}', v_e) else v_e end;
end $$;

create or replace function public.insights_records_exec(p_company uuid, p_def jsonb, p_viewer uuid, p_over jsonb, p_page int,
  p_sort jsonb, p_point jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_dtype text := p_def->>'data_type';
  v_rt text := p_def->>'report_type';
  P jsonb := coalesce(p_def->'parameters', '{}'::jsonb);
  v_filters jsonb;
  v_params jsonb;
  v_fw record;
  v_cols jsonb;
  v_meta jsonb := '[]'::jsonb;
  v_sel text := '';
  v_col record;
  v_ord text := 'r.created_at';
  v_dir text := 'desc';
  v_where text;
  v_x record;
  v_s record;
  v_res jsonb;
  v_group text;
  v_seg text;
  c text;
  n int := 0;
begin
  perform public.insights_check(p_def);
  v_filters := public.insights_apply_overrides(p_company, v_dtype, v_rt, P->'filter_by', coalesce(nullif(p_over, 'null'::jsonb), '{}'::jsonb));
  v_params := jsonb_build_object('f', (select coalesce(jsonb_agg(f || jsonb_build_object('o', coalesce(f->'operands', '[]'::jsonb))), '[]'::jsonb)
    from jsonb_array_elements(v_filters) f), 'p', coalesce(p_point, '{}'::jsonb));
  v_rt := case when v_rt = 'funnel_conversion' then 'stats' else v_rt end;
  select * into v_fw from public.insights_from_where(p_company, v_dtype, v_rt, v_filters, 0);
  v_where := v_fw.v_where;

  -- ponto clicado no gráfico
  if jsonb_typeof(p_point) = 'object' and p_def->>'report_type' <> 'funnel_conversion' then
    v_group := coalesce(nullif(P#>>'{group_by,filter}', ''),
      (select t.def_group from public.insights_report_types() t where t.dtype = v_dtype and t.rt = v_rt));
    v_seg := nullif(nullif(P->>'segment_by', ''), 'none');
    if p_def->>'report_type' = 'conversion_overall' then v_seg := 'status'; end if;
    if p_point ? 'x' and p_def->>'chart_type' <> 'scorecard' then
      select * into v_x from public.insights_dim(p_company, v_dtype, v_rt, v_group, P#>>'{group_by,interval}', 'x');
      v_fw.v_from := v_fw.v_from || v_x.j;
      v_where := v_where || format(' and coalesce(%s, '''') = ($1->''p''->>''x'')', v_x.k);
    end if;
    if p_point ? 's' and v_seg is not null then
      select * into v_s from public.insights_dim(p_company, v_dtype, v_rt, v_seg, 'month', 's');
      v_fw.v_from := v_fw.v_from || v_s.j;
      v_where := v_where || format(' and coalesce(%s, '''') = ($1->''p''->>''s'')', v_s.k);
    end if;
  end if;

  v_cols := coalesce(nullif(p_def->'columns', '[]'::jsonb), public.insights_default_columns(v_dtype));
  for c in select jsonb_array_elements_text(v_cols) loop
    select * into v_col from public.insights_column(p_company, v_dtype, c);
    v_sel := v_sel || case when n = 0 then '' else ', ' end || v_col.expr;
    v_meta := v_meta || jsonb_build_array(jsonb_build_object('id', c, 'label', v_col.label, 'type', v_col.ctype));
    if p_sort->>'col' = c then
      v_ord := v_col.expr;
      v_dir := case when p_sort->>'dir' = 'asc' then 'asc' else 'desc' end;
    end if;
    n := n + 1;
  end loop;

  execute format(
    'with vis as materialized (%1$s), ids as (select distinct r.id from %2$s where %3$s), '
    'page as (select r.id, jsonb_build_array(%4$s) as cells, row_number() over (order by %5$s %6$s nulls last, r.id) as rn '
    '  from public.%7$I r where r.id in (select id from ids) order by rn limit 50 offset %8$s) '
    'select jsonb_build_object(''total'', (select count(*) from ids), '
    '  ''rows'', coalesce((select jsonb_agg(jsonb_build_array(id) || cells order by rn) from page), ''[]''::jsonb))',
    public.insights_vis(v_dtype), v_fw.v_from, v_where, v_sel, v_ord, v_dir, public.insights_table(v_dtype),
    greatest(coalesce(p_page, 0), 0) * 50)
    into v_res using v_params, p_company, p_viewer;
  return jsonb_build_object('columns', v_meta, 'total', v_res->'total', 'rows', v_res->'rows');
end $$;

-- 9. Catálogo para a tela --------------------------------------------------------------------------------------------
create or replace function public.insights_catalog_for(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_fields jsonb := '{}'::jsonb;
  v_ops jsonb := '{"TEXT":["isExactly","isNot","isNotAnyOf","isEmpty","isNotEmpty","contains","notContains","startsWith","endsWith"],
    "USER":["isExactly","isNot","isAnyOf","isNotAnyOf","isEmpty","isNotEmpty"],
    "BOOLEAN":["isExactly","isNot","isEmpty","isNotEmpty"],
    "ORGANIZATION":["isExactly","isNot","isAnyOf","isNotAnyOf","isEmpty","isNotEmpty"],
    "PERSON":["isExactly","isNot","isAnyOf","isNotAnyOf","isEmpty","isNotEmpty"],
    "DEAL":["isExactly","isNot","isEmpty","isNotEmpty"], "LEAD":["isExactly","isNot","isEmpty","isNotEmpty"],
    "MONETARY":["isExactly","isNot","isMoreThan","isLessThan","isEmpty","isNotEmpty"],
    "NUMERICAL":["isExactly","isNot","isMoreThan","isLessThan","isEmpty","isNotEmpty"],
    "SINGLE_OPTION":["isExactly","isNot","isAnyOf","isNotAnyOf","isEmpty","isNotEmpty"],
    "MULTIPLE_OPTIONS":["isExactly","isNot","isAnyOf","isNotAnyOf","isEmpty","isNotEmpty"],
    "ID":["isExactly","isNot","isAnyOf","isNotAnyOf","isEmpty","isNotEmpty"],
    "PRODUCT":["isExactly","isNot","isAnyOf","isNotAnyOf","isEmpty","isNotEmpty","isExcluding"],
    "DATE":["isMoreThan","isLessThan","isEmpty","isNotEmpty"], "DATE_TIME":["isMoreThan","isLessThan","isEmpty","isNotEmpty"]}'::jsonb;
  d text;
begin
  foreach d in array array['deals', 'leads', 'activities', 'organizations', 'people'] loop
    v_fields := v_fields || jsonb_build_object(d, (
      select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'type', x.ftype, 'roles', x.roles,
        'opts', case when left(coalesce(x.opts, ''), 1) = '[' then x.opts::jsonb else to_jsonb(x.opts) end,
        'agg', x.agg, 'rts', case when x.rts is null then null else to_jsonb(string_to_array(x.rts, ',')) end,
        'custom', x.custom, 'operators', v_ops->x.ftype) order by x.custom, x.ord), '[]'::jsonb)
      from (
        select f.id, f.name, f.ftype, f.roles, f.opts, f.agg, f.rts, false as custom, row_number() over () as ord
        from public.insights_native_fields() f where f.dtype = d
        union all
        select cf.id, cf.name, cf.ftype, cf.roles, cf.opts, cf.agg, null, true, row_number() over (order by c.position, c.label)
        from public.custom_field_defs c
        cross join lateral public.insights_field(p_company, d, null, c.key) cf
        where c.company_id = p_company and c.entity = public.insights_table(d) and c.archived_at is null and d <> 'activities'
          and cf.id is not null
      ) x));
  end loop;
  return jsonb_build_object(
    'report_types', (select jsonb_agg(jsonb_build_object('data_type', t.dtype, 'report_type', t.rt, 'charts', to_jsonb(t.charts),
      'default_group', t.def_group, 'default_measure', t.def_measure)) from public.insights_report_types() t),
    'fields', v_fields,
    'links', '{"activities":{"deal_id_":"deals","lead_id_":"leads","person_id_":"people","org_id_":"organizations"},
      "deals":{"lead_id_":"leads","person_id_":"people","org_id_":"organizations","activity_id_":"activities"},
      "leads":{"deal_id_":"deals","person_id_":"people","org_id_":"organizations","activity_id_":"activities"},
      "organizations":{"lead_id_":"leads","deal_id_":"deals","person_id_":"people","activity_id_":"activities"},
      "people":{"lead_id_":"leads","deal_id_":"deals","org_id_":"organizations","activity_id_":"activities"}}'::jsonb,
    'options', jsonb_build_object(
      'users', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', coalesce(nullif(p.full_name, ''), p.email), 'active', p.active)
          order by p.active desc, coalesce(nullif(p.full_name, ''), p.email)), '[]'::jsonb)
        from public.profiles p where exists (select 1 from public.memberships m where m.user_id = p.id and m.company_id = p_company)),
      'labels', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'label', l.name, 'color', l.color) order by l.name), '[]'::jsonb)
        from public.labels l where l.company_id = p_company),
      'channels', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.name, 'active', s.active) order by s.position, s.name), '[]'::jsonb)
        from public.lead_sources s where s.company_id = p_company),
      'outcomes', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.name, 'active', o.active) order by o.position, o.name), '[]'::jsonb)
        from public.activity_outcomes o where o.company_id = p_company),
      'acttypes', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.name, 'active', t.active) order by t.position, t.name), '[]'::jsonb)
        from public.activity_types t where t.company_id = p_company),
      'actchannels', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'label', c.name, 'active', c.active) order by c.position, c.name), '[]'::jsonb)
        from public.activity_channels c where c.company_id = p_company),
      'kinds', (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'label', k.name, 'active', k.active) order by k.ord, k.position, k.name), '[]'::jsonb)
        from (select t.id, t.name, t.active, t.position, 1 as ord from public.activity_types t where t.company_id = p_company and t.is_meeting
              union all select c.id, c.name, c.active, c.position, 2 from public.activity_channels c where c.company_id = p_company) k),
      'pipelines', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', p.name, 'active', p.archived_at is null) order by p.position, p.name), '[]'::jsonb)
        from public.pipelines p where p.company_id = p_company),
      'stages', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'label', s.name, 'pipeline_id', s.pipeline_id, 'active', s.archived_at is null)
          order by p.position, s.position), '[]'::jsonb)
        from public.stages s join public.pipelines p on p.id = s.pipeline_id where s.company_id = p_company),
      'lost_reasons', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'label', l.name, 'active', l.active) order by l.position, l.name), '[]'::jsonb)
        from public.lost_reasons l where l.company_id = p_company),
      'disq_reasons', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'label', l.name, 'active', l.active) order by l.position, l.name), '[]'::jsonb)
        from public.disqualification_reasons l where l.company_id = p_company),
      'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', p.name, 'active', p.active) order by p.name), '[]'::jsonb)
        from public.products p where p.company_id = p_company),
      'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.name) order by t.name), '[]'::jsonb)
        from public.teams t where exists (select 1 from public.team_members tm join public.memberships m on m.user_id = tm.user_id
          where tm.team_id = t.id and m.company_id = p_company))));
end $$;

-- Busca de organizações, pessoas, negócios e leads para os filtros (até 20).
create or replace function public.insights_search(p_company uuid, p_kind text, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := '%' || coalesce(p_q, '') || '%';
begin
  if not (public.is_super_admin() or public.has_report_setting(p_company, 'view_reports')) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  return case p_kind
    when 'orgs' then (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'label', o.name)), '[]'::jsonb) from (
      select o.id, o.name from public.organizations o where o.company_id = p_company and o.deleted_at is null and o.name ilike v_q
      order by o.name limit 20) o)
    when 'persons' then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'label', p.full_name)), '[]'::jsonb) from (
      select p.id, p.full_name from public.persons p where p.company_id = p_company and p.deleted_at is null and p.full_name ilike v_q
      order by p.full_name limit 20) p)
    when 'deals' then (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'label', d.title)), '[]'::jsonb) from (
      select d.id, d.title from public.deals d where d.company_id = p_company and d.deleted_at is null and d.title ilike v_q
      order by d.title limit 20) d)
    when 'leads' then (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'label', l.title)), '[]'::jsonb) from (
      select l.id, l.title from public.leads l where l.company_id = p_company and l.deleted_at is null and l.title ilike v_q
      order by l.title limit 20) l)
    else '[]'::jsonb end;
end $$;

-- 10. Entradas públicas ------------------------------------------------------------------------------------------------
create or replace function public.insights_can_view(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_active() and (public.is_super_admin() or public.has_report_setting(p_company, 'view_reports'));
$$;

create or replace function public.insights_catalog(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.insights_can_view(p_company) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  return public.insights_catalog_for(p_company);
end $$;

create or replace function public.insights_run(p_company uuid, p_def jsonb, p_overrides jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.insights_can_view(p_company) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  return public.insights_exec(p_company, p_def, auth.uid(), p_overrides);
end $$;

create or replace function public.insights_records(p_company uuid, p_def jsonb, p_overrides jsonb default '{}'::jsonb,
  p_page int default 0, p_sort jsonb default null, p_point jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.insights_can_view(p_company) then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  return public.insights_records_exec(p_company, p_def, auth.uid(), p_overrides, p_page, p_sort, p_point);
end $$;

-- Link público: painel e relatórios do token; dados com a visibilidade do dono.
create or replace function public.insights_public_dashboard(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_dash uuid := public.insight_link_dashboard(p_token);
begin
  if v_dash is null then
    return null;
  end if;
  return (select jsonb_build_object('id', d.id, 'name', d.name, 'company_id', d.company_id,
    'items', coalesce((select jsonb_agg(jsonb_build_object('report_id', r.id, 'name', r.name, 'data_type', r.data_type,
        'report_type', r.report_type, 'chart_type', r.chart_type, 'parameters', r.parameters, 'columns', r.columns,
        'colors', r.colors, 'x', i.x, 'y', i.y, 'w', i.w, 'h', i.h) order by i.y, i.x)
      from public.insight_dashboard_reports i join public.insight_reports r on r.id = i.report_id
      where i.dashboard_id = d.id), '[]'::jsonb))
    from public.insight_dashboards d where d.id = v_dash);
end $$;

create or replace function public.insights_run_public(p_token text, p_report uuid, p_overrides jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_dash uuid := public.insight_link_dashboard(p_token);
  v_r record;
  v_owner uuid;
begin
  select r.* into v_r from public.insight_reports r
  join public.insight_dashboard_reports i on i.report_id = r.id and i.dashboard_id = v_dash
  where r.id = p_report;
  if v_dash is null or v_r.id is null then
    raise exception 'OXYN_FORBIDDEN';
  end if;
  select d.owner_id into v_owner from public.insight_dashboards d where d.id = v_dash;
  return public.insights_exec(v_r.company_id, jsonb_build_object('data_type', v_r.data_type, 'report_type', v_r.report_type,
    'chart_type', v_r.chart_type, 'parameters', v_r.parameters, 'columns', v_r.columns), v_owner, p_overrides);
end $$;

-- Validação ao salvar: a definição precisa compilar (campos, operadores, eixos).
create or replace function public.insights_validate_trigger() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_def jsonb := jsonb_build_object('data_type', new.data_type, 'report_type', new.report_type, 'chart_type', new.chart_type,
    'parameters', new.parameters, 'columns', new.columns);
  c text;
begin
  perform public.insights_check(v_def);
  perform public.insights_from_where(new.company_id, new.data_type, new.report_type,
    coalesce(new.parameters->'filter_by', '[]'::jsonb), 0);
  perform public.insights_measure(new.company_id, new.data_type, new.report_type, new.parameters->>'measure_by',
    new.parameters->>'measure_by_aggregation');
  if new.report_type <> 'funnel_conversion' and new.chart_type <> 'scorecard' then
    perform public.insights_dim(new.company_id, new.data_type, new.report_type,
      coalesce(nullif(new.parameters#>>'{group_by,filter}', ''),
        (select t.def_group from public.insights_report_types() t where t.dtype = new.data_type and t.rt = new.report_type)),
      new.parameters#>>'{group_by,interval}', 'x');
  end if;
  if nullif(nullif(new.parameters->>'segment_by', ''), 'none') is not null then
    perform public.insights_dim(new.company_id, new.data_type, new.report_type, new.parameters->>'segment_by', 'month', 's');
  end if;
  for c in select jsonb_array_elements_text(new.columns) loop
    perform public.insights_column(new.company_id, new.data_type, c);
  end loop;
  return new;
end $$;
drop trigger if exists validate_definition on public.insight_reports;
create trigger validate_definition before insert or update of data_type, report_type, chart_type, parameters, columns
  on public.insight_reports for each row execute function public.insights_validate_trigger();

-- 11. Permissões ------------------------------------------------------------------------------------------------------
revoke execute on function public.insights_period_bounds(text, int, date, date), public.insights_native_fields(),
  public.insights_report_types(), public.insights_table(text), public.insights_link(text, text),
  public.insights_field(uuid, text, text, text), public.insights_disp(text, text, text), public.insights_order(text, text),
  public.insights_is_date(text), public.insights_sp_date(text, text), public.insights_operand(int, int),
  public.insights_filter_bounds(jsonb, int), public.insights_filter_sql(uuid, text, text, jsonb, int, int),
  public.insights_dim(uuid, text, text, text, text, text), public.insights_measure(uuid, text, text, text, text),
  public.insights_apply_overrides(uuid, text, text, jsonb, jsonb), public.insights_check(jsonb),
  public.insights_from_where(uuid, text, text, jsonb, int), public.insights_vis(text),
  public.insights_exec(uuid, jsonb, uuid, jsonb),
  public.insights_grouped(uuid, text, text, text, text, text, jsonb, int, text, text, jsonb, uuid),
  public.insights_exec_funnel(uuid, jsonb, uuid, jsonb, jsonb), public.insights_default_columns(text),
  public.insights_column(uuid, text, text), public.insights_records_exec(uuid, jsonb, uuid, jsonb, int, jsonb, jsonb),
  public.insights_catalog_for(uuid), public.insights_public_dashboard(text), public.insights_run_public(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insights_exec(uuid, jsonb, uuid, jsonb), public.insights_catalog_for(uuid),
  public.insights_records_exec(uuid, jsonb, uuid, jsonb, int, jsonb, jsonb),
  public.insights_public_dashboard(text), public.insights_run_public(text, uuid, jsonb) to service_role;
revoke execute on function public.insights_catalog(uuid), public.insights_run(uuid, jsonb, jsonb),
  public.insights_records(uuid, jsonb, jsonb, int, jsonb, jsonb), public.insights_search(uuid, text, text),
  public.insights_can_view(uuid) from public, anon;
grant execute on function public.insights_catalog(uuid), public.insights_run(uuid, jsonb, jsonb),
  public.insights_records(uuid, jsonb, jsonb, int, jsonb, jsonb), public.insights_search(uuid, text, text),
  public.insights_can_view(uuid) to authenticated;
