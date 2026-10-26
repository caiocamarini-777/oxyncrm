begin;
select plan(4);

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

insert into companies (id, name, slug) values (pg_temp.u(1), 'Dash Teste', 'tst-dash');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
select pg_temp.u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ds' || n || '@oxyn.test', '{"full_name":"x"}'
from unnest(array[11, 12]) n;
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor-dash', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(12), pg_temp.u(1), pg_temp.u(21));

-- usuário comum (não admin geral) com create_dashboards
select pg_temp.as_user(pg_temp.u(11));
select lives_ok($$ insert into dashboards (owner_id, name) values (pg_temp.u(11), 'tst-meu painel') returning id $$,
  'usuário comum cria dashboard com returning');
select is((select count(*) from dashboards where name = 'tst-meu painel'), 1::bigint, 'o dono lê o próprio dashboard');

-- outro membro sem compartilhamento continua sem ver
select pg_temp.as_user(pg_temp.u(12));
select is((select count(*) from dashboards where name = 'tst-meu painel'), 0::bigint, 'outro usuário não vê dashboard não compartilhado');

-- dono desativado não lê mais o próprio dashboard
select pg_temp.as_pg();
update profiles set active = false where id = pg_temp.u(11);
select pg_temp.as_user(pg_temp.u(11));
select is((select count(*) from dashboards where name = 'tst-meu painel'), 0::bigint, 'dono desativado não lê');

select pg_temp.as_pg();
select * from finish();
rollback;
