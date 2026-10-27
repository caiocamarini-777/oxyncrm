begin;
select plan(17);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('role', 'service_role', true);
end $$;
create function pg_temp.as_pg() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- período corrente das metas, pela data de hoje em São Paulo
create function pg_temp.today() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date $$;
create function pg_temp.month_start() returns text language sql stable as $$
  select to_char(date_trunc('month', pg_temp.today()::timestamp), 'YYYY-MM-DD') $$;
create function pg_temp.month_end() returns text language sql stable as $$
  select to_char(date_trunc('month', pg_temp.today()::timestamp) + interval '1 month' - interval '1 day', 'YYYY-MM-DD') $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_service(), pg_temp.as_pg(),
  pg_temp.today(), pg_temp.month_start(), pg_temp.month_end() to public;
create temp table tok (n int primary key, token text);
grant all on tok to public;

insert into companies (id, name, slug) values
  (pg_temp.u(1), 'Volt Teste', 'tst-volt'), (pg_temp.u(2), 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-g@oxyn.test', '{"full_name":"tst-gestor"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-v@oxyn.test', '{"full_name":"tst-vend"}'),
  (pg_temp.u(14), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-v2@oxyn.test', '{"full_name":"tst-vend2"}'),
  (pg_temp.u(15), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-g2@oxyn.test', '{"full_name":"tst-gestor2"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-Vendedor', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  (pg_temp.u(23), 'tst-Gestor2', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22)),
  (pg_temp.u(14), pg_temp.u(1), pg_temp.u(22)), (pg_temp.u(15), pg_temp.u(2), pg_temp.u(23));
insert into teams (id, name) values (pg_temp.u(31), 'tst-time-a'), (pg_temp.u(32), 'tst-time-b');
insert into team_members (team_id, user_id) values
  (pg_temp.u(31), pg_temp.u(11)), (pg_temp.u(31), pg_temp.u(13)), (pg_temp.u(32), pg_temp.u(14));

insert into pipelines (id, company_id, name) values
  (pg_temp.u(401), pg_temp.u(1), 'tst-funil'), (pg_temp.u(402), pg_temp.u(2), 'tst-funil2');
insert into stages (id, pipeline_id, company_id, name, position, probability) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e1', 0, 10),
  (pg_temp.u(502), pg_temp.u(402), pg_temp.u(2), 'tst-e1b', 0, 10);
insert into leads (id, company_id, owner_id, title, created_at) values
  (pg_temp.u(101), pg_temp.u(1), pg_temp.u(11), 'tst-l1', '2026-03-01 09:00-03');

-- Negócios: 4 na Volt (2 do gestor, 1 de cada vendedor), 1 na Naia. Os ganhos são de agora (metas).
alter table deals disable trigger deals_status_fields;
alter table deals disable trigger deals_stage_entry;
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, created_at, won_at, setup_total, setup_first_due, mrr, mrr_start, contract_months) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-d1', pg_temp.u(401), pg_temp.u(501), 'open', '2026-03-10 10:00-03', null, 0, null, 0, null, null),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(11), 'tst-d2', pg_temp.u(401), pg_temp.u(501), 'won', '2026-01-10 10:00-03', now(), 1000, '2026-01-01', 0, null, null),
  (pg_temp.u(203), pg_temp.u(1), pg_temp.u(13), 'tst-d3', pg_temp.u(401), pg_temp.u(501), 'won', '2026-03-15 10:00-03', now(), 200, '2026-03-01', 50, '2026-04-01', 6),
  (pg_temp.u(204), pg_temp.u(1), pg_temp.u(14), 'tst-d4', pg_temp.u(401), pg_temp.u(501), 'open', '2026-03-20 10:00-03', null, 0, null, 0, null, null),
  (pg_temp.u(205), pg_temp.u(2), pg_temp.u(15), 'tst-d5', pg_temp.u(402), pg_temp.u(502), 'open', '2026-03-12 10:00-03', null, 0, null, 0, null, null);
alter table deals enable trigger deals_status_fields;
alter table deals enable trigger deals_stage_entry;

-- Atividades de agora: tentativa que agendou, a reunião realizada, e uma legada que não conta
insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, done, completed_at,
  outcome_id, meeting_outcome, origin_channel_id, lead_id, legacy)
select pg_temp.u(n), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11),
  (select id from activity_types where company_id = pg_temp.u(1) and name = t),
  (select id from activity_channels where company_id = pg_temp.u(1) and name = 'LinkedIn'),
  'tst-ativ-' || n, now(), true, now(),
  (select id from activity_outcomes where company_id = pg_temp.u(1) and name = oc),
  mo, (select id from activity_channels where company_id = pg_temp.u(1) and name = och), pg_temp.u(101), lg
from (values
  (301, 'Mensagem', 'Reunião agendada', null, null, false),
  (302, 'Reunião', null, 'held', 'LinkedIn', false),
  (303, 'Mensagem', 'Reunião agendada', null, null, true)
) v(n, t, oc, mo, och, lg);
update activities set booked_by_activity_id = pg_temp.u(301) where id = pg_temp.u(302);

-- Metas (início em janeiro; período corrente = o que contém hoje)
insert into goals (id, company_id, target_kind, target_user_id, target_team_id, metric, period, starts_on, target_value, created_by) values
  (pg_temp.u(901), pg_temp.u(1), 'company', null, null, 'won_value', 'month', '2026-01-01', 1000, pg_temp.u(11)),
  (pg_temp.u(902), pg_temp.u(1), 'user', pg_temp.u(13), null, 'won_value', 'month', '2026-01-01', 250, pg_temp.u(11)),
  (pg_temp.u(903), pg_temp.u(1), 'team', null, pg_temp.u(31), 'won_value', 'month', '2026-01-01', 3000, pg_temp.u(11)),
  (pg_temp.u(904), pg_temp.u(1), 'company', null, null, 'meetings_booked', 'week', '2026-01-05', 4, pg_temp.u(11)),
  (pg_temp.u(905), pg_temp.u(1), 'company', null, null, 'meetings_held', 'quarter', '2026-01-01', 2, pg_temp.u(11)),
  (pg_temp.u(906), pg_temp.u(1), 'company', null, null, 'activities_done', 'month', '2026-01-01', 10, pg_temp.u(11)),
  (pg_temp.u(907), pg_temp.u(1), 'team', null, pg_temp.u(31), 'won_mrr', 'month', '2026-01-01', 100, pg_temp.u(11));

-- 5. progresso de metas ------------------------------------------------------------------------------
select is(goal_progress(pg_temp.u(901), pg_temp.u(11)),
  jsonb_build_object('target', 1000, 'actual', 1500, 'percent', 150, 'period_start', pg_temp.month_start(),
    'period_end', pg_temp.month_end()),
  'meta mensal de won_value: actual e percent exatos');
select is(goal_progress(pg_temp.u(901), pg_temp.u(13))->'actual', '500'::jsonb, 'goal_progress respeita a visibilidade do viewer');
select is(goal_progress(pg_temp.u(903), pg_temp.u(11))->'actual', '1500'::jsonb, 'meta de equipe soma os membros');
select is(goal_progress(pg_temp.u(902), pg_temp.u(11))->'percent', '200'::jsonb, 'alvo atingido em dobro dá 200');
select is(goal_progress(pg_temp.u(907), pg_temp.u(11))->'actual', '50'::jsonb, 'won_mrr soma o mrr dos ganhos');
select is(goal_progress(pg_temp.u(904), pg_temp.u(11)) - 'target' - 'percent',
  jsonb_build_object('actual', 1, 'period_start', to_char(date_trunc('week', pg_temp.today()::timestamp), 'YYYY-MM-DD'),
    'period_end', to_char(date_trunc('week', pg_temp.today()::timestamp) + interval '6 days', 'YYYY-MM-DD')),
  'meta semanal de reuniões agendadas (sem legadas), na semana corrente');
select is(goal_progress(pg_temp.u(905), pg_temp.u(11)) - 'target' - 'percent',
  jsonb_build_object('actual', 1, 'period_start', to_char(date_trunc('quarter', pg_temp.today()::timestamp), 'YYYY-MM-DD'),
    'period_end', to_char(date_trunc('quarter', pg_temp.today()::timestamp) + interval '3 months' - interval '1 day', 'YYYY-MM-DD')),
  'meta trimestral de reuniões realizadas, no trimestre corrente');
select is(goal_progress(pg_temp.u(906), pg_temp.u(11))->'actual', '2'::jsonb, 'activities_done conta concluídas sem legadas');

-- fronteira do mês em São Paulo: 23:30 do último dia do mês anterior não conta; 00:30 do dia 1 conta
alter table deals disable trigger deals_status_fields;
alter table deals disable trigger deals_stage_entry;
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, status, created_at, won_at, setup_total, setup_first_due) values
  (pg_temp.u(206), pg_temp.u(2), pg_temp.u(15), 'tst-d6', pg_temp.u(402), pg_temp.u(502), 'won', '2026-01-10 10:00-03',
   (pg_temp.month_start()::timestamp - interval '30 minutes') at time zone 'America/Sao_Paulo', 1000, '2026-01-01'),
  (pg_temp.u(207), pg_temp.u(2), pg_temp.u(15), 'tst-d7', pg_temp.u(402), pg_temp.u(502), 'won', '2026-01-10 10:00-03',
   (pg_temp.month_start()::timestamp + interval '30 minutes') at time zone 'America/Sao_Paulo', 300, '2026-01-01');
alter table deals enable trigger deals_status_fields;
alter table deals enable trigger deals_stage_entry;
insert into goals (id, company_id, target_kind, metric, period, starts_on, target_value, created_by) values
  (pg_temp.u(908), pg_temp.u(2), 'company', 'won_value', 'month', '2026-01-01', 600, pg_temp.u(15));
select is(goal_progress(pg_temp.u(908), pg_temp.u(15)) - 'period_start' - 'period_end',
  '{"target":600,"actual":300,"percent":50}'::jsonb, 'fronteira do mês em São Paulo (23:30 do dia anterior fora, 00:30 do dia 1 dentro)');

select pg_temp.as_user(pg_temp.u(13));
select is((select jsonb_agg(g->'actual' order by g->>'id') from jsonb_array_elements(goals_progress_self(array[pg_temp.u(1)])) g
  where g->>'metric' = 'won_value'), '[500, 500, 500]'::jsonb, 'goals_progress_self usa o viewer auth.uid()');
select throws_ok($$ select goals_progress_self(array[pg_temp.u(2)]) $$, 'P0001', 'OXYN_FORBIDDEN', 'goals_progress_self de empresa alheia');
select throws_ok($$ select goal_progress(pg_temp.u(901), pg_temp.u(13)) $$, '42501', null, 'authenticated não executa goal_progress');


-- RLS e checks das metas (vindos do antigo 24) ---------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
  values (pg_temp.u(1), 'company', 'won_value', 'month', '2026-10-01', 100, pg_temp.u(11)) $$, '42501', null, 'não admin não cria meta');
select pg_temp.as_user(pg_temp.u(14));
select ok((select count(*) from goals where company_id = pg_temp.u(1)) > 0, 'membro lê meta da empresa');
select pg_temp.as_user(pg_temp.u(15));
select is((select count(*) from goals where company_id = pg_temp.u(1)), 0::bigint, 'outra empresa não lê meta');
select pg_temp.as_pg();
select throws_ok($$ insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
  values (pg_temp.u(1), 'company', 'won_value', 'month', '2026-10-02', 100, pg_temp.u(11)) $$, '23514', null, 'starts_on desalinhado (mês)');
select throws_ok($$ insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
  values (pg_temp.u(1), 'user', 'won_value', 'month', '2026-10-01', 100, pg_temp.u(11)) $$, '23514', null, 'meta user sem target_user_id');

select * from finish();
rollback;
