begin;
select plan(72);

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

-- Dashboards e widgets
insert into reports (id, company_id, owner_id, name, spec) values
  (pg_temp.u(801), null, pg_temp.u(11), 'tst-metas', '{"kind":"goal_progress","chart":"table"}');
insert into dashboards (id, owner_id, name, default_filters) values
  (pg_temp.u(601), pg_temp.u(11), 'tst-painel', '{"period":{"from":"2026-03-01","to":"2026-03-31"}}'),
  (pg_temp.u(602), pg_temp.u(11), 'tst-painel-2', '{}'),
  (pg_temp.u(603), pg_temp.u(13), 'tst-painel-vend', '{}');
insert into dashboard_widgets (id, dashboard_id, report_id, spec, title, position) values
  (pg_temp.u(701), pg_temp.u(601), null, '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}', 'Negócios', 0),
  (pg_temp.u(702), pg_temp.u(601), null, '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number","period":{"field":"created_at","from":"2026-03-01","to":"2026-03-31"}}', 'Março', 1),
  (pg_temp.u(703), pg_temp.u(602), null, '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}', 'Outro', 0),
  (pg_temp.u(704), pg_temp.u(601), pg_temp.u(801), null, 'Metas', 2),
  (pg_temp.u(705), pg_temp.u(601), null, '{"kind":"forecast","chart":"table"}', 'Forecast', 3),
  (pg_temp.u(708), pg_temp.u(602), null, jsonb_build_object('kind', 'custom', 'base', 'deals', 'metric', '{"op":"count"}'::jsonb,
     'chart', 'number', 'filters', (select jsonb_agg('{"field":"status","op":"in","value":["open","won","lost"]}'::jsonb) from generate_series(1, 20))), '20 filtros', 1),
  (pg_temp.u(709), pg_temp.u(602), null, jsonb_build_object('kind', 'custom', 'base', 'deals', 'metric', '{"op":"count"}'::jsonb,
     'chart', 'number', 'filters', (select jsonb_agg('{"field":"status","op":"in","value":["open","won","lost"]}'::jsonb) from generate_series(1, 21))), '21 filtros', 2),
  (pg_temp.u(706), pg_temp.u(603), null, '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}', 'Meu', 0);
insert into dashboard_shares (dashboard_id, user_id) values (pg_temp.u(601), pg_temp.u(13));

-- Metas (início em janeiro; período corrente = o que contém hoje)
insert into goals (id, company_id, target_kind, target_user_id, target_team_id, metric, period, starts_on, target_value, created_by) values
  (pg_temp.u(901), pg_temp.u(1), 'company', null, null, 'won_value', 'month', '2026-01-01', 1000, pg_temp.u(11)),
  (pg_temp.u(902), pg_temp.u(1), 'user', pg_temp.u(13), null, 'won_value', 'month', '2026-01-01', 250, pg_temp.u(11)),
  (pg_temp.u(903), pg_temp.u(1), 'team', null, pg_temp.u(31), 'won_value', 'month', '2026-01-01', 3000, pg_temp.u(11)),
  (pg_temp.u(904), pg_temp.u(1), 'company', null, null, 'meetings_booked', 'week', '2026-01-05', 4, pg_temp.u(11)),
  (pg_temp.u(905), pg_temp.u(1), 'company', null, null, 'meetings_held', 'quarter', '2026-01-01', 2, pg_temp.u(11)),
  (pg_temp.u(906), pg_temp.u(1), 'company', null, null, 'activities_done', 'month', '2026-01-01', 10, pg_temp.u(11)),
  (pg_temp.u(907), pg_temp.u(1), 'team', null, pg_temp.u(31), 'won_mrr', 'month', '2026-01-01', 100, pg_temp.u(11));

-- 1. execução de widgets ------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select is(run_widget(pg_temp.u(701), '{}')->'total', '4'::jsonb, 'dono roda o próprio widget com o próprio alcance');
select is(run_widget(pg_temp.u(701), null)->'total', '4'::jsonb, 'filtros nulos não restringem');

select pg_temp.as_user(pg_temp.u(13));
select is(run_widget(pg_temp.u(701), '{}')->'total', '4'::jsonb, 'destinatário (own) recebe os números do dono (company)');
select is(run_report_self('{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}', array[pg_temp.u(1)])->'total',
  '1'::jsonb, 'o próprio alcance do destinatário é menor');
select throws_ok($$ select run_widget(pg_temp.u(703), '{}') $$, 'P0001', 'OXYN_FORBIDDEN',
  'widget de outro dashboard do mesmo dono');
select is(run_widget(pg_temp.u(701), '{"owner":["00000000-0000-4000-8000-000000000014"]}')->'total', '1'::jsonb,
  'destinatário filtra dentro do alcance do dono');

select pg_temp.as_user(pg_temp.u(14));
select throws_ok($$ select run_widget(pg_temp.u(701), '{}') $$, 'P0001', 'OXYN_FORBIDDEN', 'terceiro sem compartilhamento');
select throws_ok($$ select run_widget('00000000-0000-4000-8000-000000009999', '{}') $$, 'P0001', 'OXYN_FORBIDDEN', 'widget inexistente');

-- 2. restrict_filters --------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select is(run_widget(pg_temp.u(701), '{"company":["00000000-0000-4000-8000-000000000002"]}'),
  '{"columns":[{"key":"value","label":"Quantidade","type":"number"}],"rows":[[0]],"total":0,"truncated":false,"chart":"number"}'::jsonb,
  'empresa que o dono não acessa dá resultado vazio');
select is(run_widget(pg_temp.u(701), '{"company":["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002"]}')->'total',
  '4'::jsonb, 'filtro de empresa é recortado às empresas do dono');
select is(run_widget(pg_temp.u(701), '{"company":[]}')->'total', '0'::jsonb, 'lista de empresas vazia não vira todas');
select is(run_widget(pg_temp.u(702), '{"period":{"from":"2026-01-01","to":"2026-12-31"}}')->'total', '3'::jsonb,
  'período maior que o da spec é recortado');
select is(run_widget(pg_temp.u(702), '{"period":{"from":"2026-03-12","to":"2026-06-30"}}')->'total', '2'::jsonb,
  'período é a interseção');
select is(run_widget(pg_temp.u(702), '{"period":{"from":"2026-05-01","to":"2026-05-31"}}')->'total', '0'::jsonb,
  'interseção vazia dá resultado vazio');
select is(run_widget(pg_temp.u(701), '{"period":{"from":"2026-03-01","to":"2026-03-31"}}')->'total', '3'::jsonb,
  'spec sem período recebe o período do filtro no campo padrão');
select is(run_widget(pg_temp.u(701), '{"owner":["00000000-0000-4000-8000-000000000013"]}')->'total', '1'::jsonb,
  'filtro owner restringe');
select is(run_widget(pg_temp.u(701), '{"team":["00000000-0000-4000-8000-000000000032"]}')->'total', '1'::jsonb,
  'filtro team restringe');
select is(run_widget(pg_temp.u(701), '{"owner":[]}')->'total', '0'::jsonb, 'owner vazio não amplia');
select is(run_widget(pg_temp.u(705), '{"period":{"from":"2026-03-01","to":"2026-03-31"}}')->'rows', '[]'::jsonb,
  'preset sem período recebe o período do filtro');
select is(run_widget(pg_temp.u(708), '{"owner":["00000000-0000-4000-8000-000000000013"],"team":["00000000-0000-4000-8000-000000000031"]}')->'total',
  '1'::jsonb, 'spec com 20 filtros aceita owner e team do dashboard (fora do limite)');
select throws_ok($$ select run_widget(pg_temp.u(709), '{}') $$, 'P0001', 'OXYN_INVALID_REPORT',
  'spec do usuário com 21 filtros continua inválida');
select throws_ok($$ select run_widget(pg_temp.u(701), '{"x":1}') $$, 'P0001', 'OXYN_INVALID_REPORT', 'chave de filtro desconhecida');
select throws_ok($$ select run_widget(pg_temp.u(701), '{"owner":["nao-uuid"]}') $$, 'P0001', 'OXYN_INVALID_REPORT', 'owner inválido');
select throws_ok($$ select run_widget(pg_temp.u(701), '{"period":{"from":"2026-05-01","to":"2026-04-01"}}') $$, 'P0001',
  'OXYN_INVALID_REPORT', 'período invertido');

-- 3. dono sem condições de compartilhar ---------------------------------------------------------------
select pg_temp.as_pg();
update profiles set active = false where id = pg_temp.u(11);
select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select run_widget(pg_temp.u(701), '{}') $$, 'P0001', 'OXYN_FORBIDDEN', 'dono desativado: compartilhado é negado');
select pg_temp.as_pg();
update profiles set active = true where id = pg_temp.u(11);
update roles set permissions = jsonb_set(permissions, '{settings,share_dashboards}', 'false') where id = pg_temp.u(21);
select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select run_widget(pg_temp.u(701), '{}') $$, 'P0001', 'OXYN_FORBIDDEN', 'dono sem share_dashboards: compartilhado é negado');
select pg_temp.as_user(pg_temp.u(11));
select is(run_widget(pg_temp.u(701), '{}')->'total', '4'::jsonb, 'dono sem share_dashboards ainda vê o próprio dashboard');
select pg_temp.as_pg();
update roles set permissions = jsonb_set(permissions, '{settings,share_dashboards}', 'true') where id = pg_temp.u(21);

-- 4. links públicos ----------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select create_share_link(pg_temp.u(603), null) $$, 'P0001', 'OXYN_FORBIDDEN',
  'create_share_link sem share_dashboards');
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ select create_share_link(pg_temp.u(603), null) $$, 'P0001', 'OXYN_FORBIDDEN', 'só o dono cria link');
select throws_ok($$ select create_share_link(pg_temp.u(601), now() - interval '1 day') $$, 'P0001', 'OXYN_INVALID_INPUT',
  'validade no passado');
insert into tok values (1, create_share_link(pg_temp.u(601), null)->>'token'),
  (2, create_share_link(pg_temp.u(601), now() + interval '7 days')->>'token'), (3, create_share_link(pg_temp.u(601), null)->>'token');
select ok((select token ~ '^[A-Za-z0-9_-]{43}$' from tok where n = 1), 'token em base64url de 32 bytes');

select pg_temp.as_pg();
select is((select count(*)::int from dashboard_share_links l join tok t on l.token_hash = t.token), 0,
  'o hash guardado é diferente do token');
select is((select count(*)::int from dashboard_share_links l join tok t
  on l.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex')), 3, 'o hash é o sha256 do token');

select pg_temp.as_service();
select is((select dashboard_public(token) from tok where n = 1)->>'name', 'tst-painel', 'o token funciona em dashboard_public');
select is((select dashboard_public(token) from tok where n = 1)->'default_filters',
  '{"period":{"from":"2026-03-01","to":"2026-03-31"}}'::jsonb, 'dashboard_public devolve os filtros padrão');
select is((select array_agg(distinct k order by k) from tok, jsonb_array_elements(dashboard_public(token)->'widgets') w,
  jsonb_object_keys(w) k where n = 1), array['chart','col_span','id','position','row_span','title'],
  'widgets públicos sem specs');
select is((select jsonb_array_length(dashboard_public(token)->'widgets') from tok where n = 1), 4, 'todos os widgets do dashboard');
select is(dashboard_public('token-invalido'), null, 'token inválido dá null');
select is((select run_widget_public(token, pg_temp.u(701), '{}') from tok where n = 1)->'total', '4'::jsonb,
  'run_widget_public usa o alcance do dono');
select throws_ok($$ select run_widget_public((select token from tok where n = 1), pg_temp.u(703), '{}') $$, 'P0001',
  'OXYN_FORBIDDEN', 'run_widget_public com widget de outro dashboard');

select pg_temp.as_pg();
select set_config('tst.link1', (select l.id::text from dashboard_share_links l join tok t
  on l.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex') where t.n = 1), true);
select pg_temp.as_user(pg_temp.u(13));
select throws_ok($$ select revoke_share_link(current_setting('tst.link1')::uuid) $$, 'P0001', 'OXYN_FORBIDDEN',
  'só o dono revoga');
select throws_ok($$ select dashboard_public('x') $$, '42501', null, 'authenticated não executa dashboard_public');
select throws_ok($$ select run_widget_public('x', pg_temp.u(701), '{}') $$, '42501', null, 'authenticated não executa run_widget_public');

select pg_temp.as_user(pg_temp.u(11));
select revoke_share_link(current_setting('tst.link1')::uuid);
select pg_temp.as_pg();
update dashboard_share_links l set expires_at = now() - interval '1 minute' from tok t
 where t.n = 2 and l.token_hash = encode(extensions.digest(t.token, 'sha256'), 'hex');
select pg_temp.as_service();
select is((select dashboard_public(token) from tok where n = 1), null, 'token revogado dá null');
select is((select dashboard_public(token) from tok where n = 2), null, 'token expirado dá null');
select throws_ok($$ select run_widget_public((select token from tok where n = 1), pg_temp.u(701), '{}') $$, 'P0001',
  'OXYN_FORBIDDEN', 'run_widget_public com token revogado');
select pg_temp.as_pg();
update profiles set active = false where id = pg_temp.u(11);
select pg_temp.as_service();
select is((select dashboard_public(token) from tok where n = 3), null, 'dono desativado: link dá null');
select throws_ok($$ select run_widget_public((select token from tok where n = 3), pg_temp.u(701), '{}') $$, 'P0001',
  'OXYN_FORBIDDEN', 'dono desativado: run_widget_public negado');
select pg_temp.as_pg();
update profiles set active = true where id = pg_temp.u(11);
update roles set permissions = jsonb_set(permissions, '{settings,share_dashboards}', 'false') where id = pg_temp.u(21);
select pg_temp.as_service();
select is((select dashboard_public(token) from tok where n = 3), null, 'dono sem share_dashboards: link dá null');
select throws_ok($$ select run_widget_public((select token from tok where n = 3), pg_temp.u(701), '{}') $$, 'P0001',
  'OXYN_FORBIDDEN', 'dono sem share_dashboards: run_widget_public negado');
select pg_temp.as_pg();
update roles set permissions = jsonb_set(permissions, '{settings,share_dashboards}', 'true') where id = pg_temp.u(21);
select pg_temp.as_service();
select is((select dashboard_public(token) from tok where n = 3)->>'name', 'tst-painel', 'link volta a valer com share_dashboards');

-- 4b. links só por RPC ---------------------------------------------------------------------------------
select pg_temp.as_pg();
select is((select revoked_at is not null from dashboard_share_links where id = current_setting('tst.link1')::uuid), true,
  'revoke_share_link grava revoked_at');
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ insert into dashboard_share_links (dashboard_id, token_hash, created_by)
  values (pg_temp.u(601), 'hash-escolhido', pg_temp.u(11)) $$, '42501', null, 'dono não insere link direto');
select throws_ok($$ update dashboard_share_links set revoked_at = null where id = current_setting('tst.link1')::uuid $$,
  '42501', null, 'dono não desfaz a revogação direto');
select throws_ok($$ update dashboard_share_links set expires_at = null where dashboard_id = pg_temp.u(601) $$,
  '42501', null, 'dono não muda a validade direto');
select is((select count(*)::int from dashboard_share_links where dashboard_id = pg_temp.u(601)), 3,
  'dono ainda lista os próprios links (sem token_hash)');
select pg_temp.as_pg();

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

-- 6. preset goal_progress ----------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select is((select r from jsonb_array_elements(run_widget(pg_temp.u(704), '{}')->'rows') r where r->>0 like 'Valor ganho (Volt%'),
  jsonb_build_array('Valor ganho (Volt Teste)', 1000, 1500, 150, pg_temp.month_start(), pg_temp.month_end(), 'won_value'),
  'preset goal_progress pelo widget com report_id');
select is(run_widget(pg_temp.u(704), '{"owner":["00000000-0000-4000-8000-000000000013"]}')->'rows',
  jsonb_build_array(jsonb_build_array('Valor ganho (tst-vend)', 250, 500, 200, pg_temp.month_start(), pg_temp.month_end(), 'won_value')),
  'preset goal_progress com filtro owner mostra só as metas do usuário');
select is((select jsonb_path_query_array(run_widget(pg_temp.u(704), '{}')->'columns', '$[*].key')), '["goal","target","actual","percent","period_start","period_end","metric"]'::jsonb,
  'preset goal_progress expõe a coluna metric');
select throws_ok($$ select run_report_self('{"kind":"goal_progress","params":{"x":1}}', array[pg_temp.u(1)]) $$, 'P0001',
  'OXYN_INVALID_REPORT', 'goal_progress não aceita params');

select * from finish();
rollback;
