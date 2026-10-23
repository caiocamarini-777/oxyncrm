begin;
select plan(6);

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
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;
create function pg_temp.as_pg() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_service(), pg_temp.as_anon(),
  pg_temp.as_pg() to public;
create temp table tok (n int primary key, token text, link_id uuid);
grant all on tok to public;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Volt Teste', 'tst-volt'), (pg_temp.u(2), 'Naia Teste', 'tst-naia');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-g@oxyn.test', '{"full_name":"tst-gestor"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21)), (pg_temp.u(11), pg_temp.u(2), pg_temp.u(21));

-- 3 negócios abertos na empresa A (Volt) e 2 na B (Naia)
insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil-a'), (pg_temp.u(402), pg_temp.u(2), 'tst-funil-b');
insert into stages (id, pipeline_id, company_id, name, position) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-ea', 0), (pg_temp.u(502), pg_temp.u(402), pg_temp.u(2), 'tst-eb', 0);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, setup_total, setup_first_due) values
  (pg_temp.u(201), pg_temp.u(1), pg_temp.u(11), 'tst-a1', pg_temp.u(401), pg_temp.u(501), 10, '2026-03-01'),
  (pg_temp.u(202), pg_temp.u(1), pg_temp.u(11), 'tst-a2', pg_temp.u(401), pg_temp.u(501), 10, '2026-03-01'),
  (pg_temp.u(203), pg_temp.u(1), pg_temp.u(11), 'tst-a3', pg_temp.u(401), pg_temp.u(501), 10, '2026-03-01'),
  (pg_temp.u(204), pg_temp.u(2), pg_temp.u(11), 'tst-b1', pg_temp.u(402), pg_temp.u(502), 10, '2026-03-01'),
  (pg_temp.u(205), pg_temp.u(2), pg_temp.u(11), 'tst-b2', pg_temp.u(402), pg_temp.u(502), 10, '2026-03-01');

insert into reports (id, company_id, owner_id, name, spec) values
  (pg_temp.u(801), pg_temp.u(1), pg_temp.u(11), 'tst-rel-a', '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}'),
  (pg_temp.u(802), null, pg_temp.u(11), 'tst-rel-livre', '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}');
insert into dashboards (id, owner_id, name) values (pg_temp.u(601), pg_temp.u(11), 'tst-painel');
insert into dashboard_widgets (id, dashboard_id, report_id, spec, title, position) values
  (pg_temp.u(701), pg_temp.u(601), pg_temp.u(801), null, 'Relatório da A', 0),
  (pg_temp.u(702), pg_temp.u(601), pg_temp.u(802), null, 'Relatório sem empresa', 1),
  (pg_temp.u(703), pg_temp.u(601), null, '{"kind":"custom","base":"deals","metric":{"op":"count"},"chart":"number"}', 'Spec própria', 2);

select pg_temp.as_user(pg_temp.u(11));
select is((run_widget(pg_temp.u(701), '{}')->'rows'->0->>0)::int, 3, 'relatório da empresa A, no escopo de todas, conta só A');
select is((run_widget(pg_temp.u(701), jsonb_build_object('company', jsonb_build_array(pg_temp.u(2))))->'rows'->0->>0)::int, 0,
  'filtro de outra empresa não amplia: conta zero');
select is((run_widget(pg_temp.u(701), jsonb_build_object('company', jsonb_build_array(pg_temp.u(1), pg_temp.u(2))))->'rows'->0->>0)::int, 3,
  'filtro com A e B continua só em A');
select is((run_widget(pg_temp.u(702), '{}')->'rows'->0->>0)::int, 5, 'relatório sem empresa usa todas as permitidas');
select is((run_widget(pg_temp.u(703), '{}')->'rows'->0->>0)::int, 5, 'widget com spec própria usa todas as permitidas');
select is((run_widget(pg_temp.u(701), '{}')->'chart'), '"number"'::jsonb, 'o gráfico continua na saída');

select * from finish();
rollback;
