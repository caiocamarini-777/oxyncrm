begin;
select plan(36);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_pg() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_pg() to public;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt'), (pg_temp.u(2), 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
select pg_temp.u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-r' || n || '@oxyn.test', '{"full_name":"x"}'
from unnest(array[11,12,13,14,15,16,17,18,19,20]) n;
-- 11 gestor c1, 12 gestor c2, 13 vendedor c1, 14 time c1, 15 colega de time c1 (own),
-- 16 sem papel de relatório c1, 17 inativo c1, 18 admin geral, 19 sem membership, 20 vendedor c1 (sem time)
update profiles set is_super_admin = true where id = pg_temp.u(18);
update profiles set active = false where id = pg_temp.u(17);

insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-Vendedor', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  (pg_temp.u(23), 'tst-Time', 'teste', '{"visibility":{"leads":"team","deals":"team","persons":"team","organizations":"team","activities":"team"},"actions":{"create":false,"edit":true,"delete":true,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  (pg_temp.u(24), 'tst-SemRel', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":false,"create_dashboards":false,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(12), pg_temp.u(2), pg_temp.u(21)),
  (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22)), (pg_temp.u(14), pg_temp.u(1), pg_temp.u(23)),
  (pg_temp.u(15), pg_temp.u(1), pg_temp.u(22)), (pg_temp.u(16), pg_temp.u(1), pg_temp.u(24)),
  (pg_temp.u(17), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(20), pg_temp.u(1), pg_temp.u(22));
insert into teams (id, name) values (pg_temp.u(31), 'tst-time-r');
insert into team_members (team_id, user_id) values (pg_temp.u(31), pg_temp.u(14)), (pg_temp.u(31), pg_temp.u(15));

-- 1. can_access_for reproduz can_access ------------------------------------------------------
create temp table m (u uuid, company uuid, entity text, owner uuid, action text, got boolean);
grant all on m to public;
do $$
declare uid uuid;
begin
  for uid in select pg_temp.u(n) from unnest(array[11,12,13,14,15,16,17,18,19,20]) n loop
    perform pg_temp.as_user(uid);
    insert into m
    select uid, c.id, e.entity, o.owner, a.action, public.can_access(c.id, e.entity, o.owner, a.action)
    from (values (pg_temp.u(1)), (pg_temp.u(2))) c(id)
    cross join (values ('leads'), ('deals'), ('persons'), ('organizations'), ('activities')) e(entity)
    cross join (select pg_temp.u(n) owner from unnest(array[11,13,14,15,20]) n) o
    cross join (values ('read'), ('create'), ('edit'), ('delete'), ('export'), ('reassign_owner')) a(action);
  end loop;
  perform pg_temp.as_pg();
end $$;
select is((select count(*) from m where got is distinct from public.can_access_for(u, company, entity, owner, action)), 0::bigint,
  'can_access_for reproduz a matriz de can_access para todos os perfis');
select ok((select count(*) from m where got) > 100 and (select count(*) from m where not got) > 100, 'matriz não é vazia nem trivial');
select ok((select bool_and(got) from m where u = pg_temp.u(18)), 'admin geral acessa tudo');
select ok((select not bool_or(got) from m where u = pg_temp.u(19)), 'sem membership não acessa nada');
select ok((select not bool_or(got) from m where u = pg_temp.u(17)), 'usuário inativo não acessa nada');
select ok(public.can_access_for(pg_temp.u(14), pg_temp.u(1), 'deals', pg_temp.u(15), 'read'), 'team: colega de time lê');
select ok(not public.can_access_for(pg_temp.u(14), pg_temp.u(1), 'deals', pg_temp.u(20), 'read'), 'team: fora do time não lê');
select ok(public.is_super_admin_for(pg_temp.u(18)) and not public.is_super_admin_for(pg_temp.u(11)), 'is_super_admin_for');
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$ select public.can_access_for(pg_temp.u(11), pg_temp.u(1), 'deals', pg_temp.u(11), 'read') $$, '42501', null,
  'authenticated não executa can_access_for');
select throws_ok($$ select public.role_permissions_for(pg_temp.u(11), pg_temp.u(1)) $$, '42501', null, 'authenticated não executa role_permissions_for');

-- 2. relatórios ------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(16));
select throws_ok($$ insert into reports (company_id, owner_id, name, spec) values (pg_temp.u(1), pg_temp.u(16), 'tst-r', '{}') $$,
  '42501', null, 'sem view_reports não cria relatório da empresa');
select pg_temp.as_user(pg_temp.u(13));
select lives_ok($$ insert into reports (company_id, owner_id, name, spec) values (pg_temp.u(1), pg_temp.u(13), 'tst-r1', '{}') $$, 'com view_reports cria relatório da empresa');
select lives_ok($$ insert into reports (company_id, owner_id, name, spec) values (null, pg_temp.u(13), 'tst-r2', '{}') $$, 'relatório sem empresa');
select throws_ok($$ insert into reports (company_id, owner_id, name, spec) values (pg_temp.u(2), pg_temp.u(13), 'tst-r3', '{}') $$,
  '42501', null, 'relatório de empresa alheia');
select pg_temp.as_user(pg_temp.u(20));
select is((select count(*) from reports where name like 'tst-r%'), 0::bigint, 'outro usuário não lê relatório alheio');
select pg_temp.as_user(pg_temp.u(18));
select is((select count(*) from reports where name like 'tst-r%'), 2::bigint, 'admin geral lê relatórios');

-- 3. dashboards ------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(16));
select throws_ok($$ insert into dashboards (id, owner_id, name) values (pg_temp.u(601), pg_temp.u(16), 'tst-d') $$,
  '42501', null, 'sem create_dashboards não cria dashboard');
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ insert into dashboards (id, owner_id, name) values (pg_temp.u(601), pg_temp.u(11), 'tst-d1') $$, 'gestor cria dashboard');
select lives_ok($$ insert into dashboard_widgets (dashboard_id, spec, title, position) values (pg_temp.u(601), '{"a":1}', 'w', 0) $$, 'dono cria widget');
select lives_ok($$ insert into dashboard_shares (dashboard_id, user_id) values (pg_temp.u(601), pg_temp.u(13)) $$, 'gestor compartilha');
select throws_ok($$ insert into dashboard_shares (dashboard_id, user_id) values (pg_temp.u(601), pg_temp.u(17)) $$,
  '42501', null, 'destinatário inativo');
select pg_temp.as_user(pg_temp.u(13));
select is((select count(*) from dashboards where id = pg_temp.u(601)), 1::bigint, 'destinatário lê o dashboard');
select is((select count(*) from dashboard_widgets where dashboard_id = pg_temp.u(601)), 1::bigint, 'destinatário lê os widgets');
update dashboards set name = 'tst-hack' where id = pg_temp.u(601);
select is((select name from dashboards where id = pg_temp.u(601)), 'tst-d1', 'destinatário não altera o dashboard');
select throws_ok($$ insert into dashboard_shares (dashboard_id, user_id) values (pg_temp.u(601), pg_temp.u(20)) $$,
  '42501', null, 'sem share_dashboards não compartilha');
select pg_temp.as_user(pg_temp.u(20));
select is((select count(*) from dashboards where id = pg_temp.u(601)), 0::bigint, 'não destinatário não lê');

-- 4. links ---------------------------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ insert into dashboard_share_links (dashboard_id, token_hash, created_by) values (pg_temp.u(601), 'tst-hash', pg_temp.u(11)) $$, 'dono cria link');
select is((select count(*) from dashboard_share_links where dashboard_id = pg_temp.u(601)), 1::bigint, 'dono lê o link sem o hash');
select throws_ok($$ select token_hash from dashboard_share_links $$, '42501', null, 'token_hash não é legível');

-- 5. metas ---------------------------------------------------------------------------------------
select throws_ok($$ insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
  values (pg_temp.u(1), 'company', 'won_value', 'month', '2026-10-01', 100, pg_temp.u(11)) $$, '42501', null, 'não admin não cria meta');
select pg_temp.as_user(pg_temp.u(18));
select lives_ok($$ insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
  values (pg_temp.u(1), 'company', 'won_value', 'month', '2026-10-01', 100, pg_temp.u(18)) $$, 'admin geral cria meta');
select pg_temp.as_user(pg_temp.u(13));
select is((select count(*) from goals), 1::bigint, 'membro lê meta da empresa');
select pg_temp.as_user(pg_temp.u(12));
select is((select count(*) from goals), 0::bigint, 'outra empresa não lê meta');

-- 6. checks ------------------------------------------------------------------------------------------
select pg_temp.as_pg();
select throws_ok($$ insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
  values (pg_temp.u(1), 'company', 'won_value', 'month', '2026-10-02', 100, pg_temp.u(18)) $$, '23514', null, 'starts_on desalinhado (mês)');
select throws_ok($$ insert into goals (company_id, target_kind, metric, period, starts_on, target_value, created_by)
  values (pg_temp.u(1), 'company', 'won_value', 'week', '2026-10-27', 100, pg_temp.u(18)) $$, '23514', null, 'starts_on desalinhado (semana: terça)');
select throws_ok($$ insert into dashboard_widgets (dashboard_id, title, position) values (pg_temp.u(601), 'w', 1) $$, '23514', null, 'widget sem report_id e sem spec');

select * from finish();
rollback;
