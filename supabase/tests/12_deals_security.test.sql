begin;
select plan(92);

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
create function pg_temp.affected(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.affected(text) to public;
grant execute on function pg_temp.as_user(uuid), pg_temp.as_pg() to public;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"ana"}'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-bruno@oxyn.test', '{"full_name":"bruno"}'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-caio@oxyn.test', '{"full_name":"caio"}'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-dani@oxyn.test', '{"full_name":"dani"}');
update profiles set is_super_admin = true where id = '00000000-0000-4000-8000-0000000000c1';

insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e1', 'tst-Equipe', 'teste', '{"visibility":{"leads":"team","deals":"team","persons":"team","organizations":"team","activities":"team"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb),
  ('00000000-0000-4000-8000-0000000000e3', 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-eva@oxyn.test', '{"full_name":"eva"}');
insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e4', 'tst-EquipeReassign', 'teste', '{"visibility":{"leads":"team","deals":"team","persons":"team","organizations":"team","activities":"team"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":true},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into teams (id, name) values ('00000000-0000-4000-8000-0000000000f1', 'tst-SDR');
insert into team_members (team_id, user_id) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c2'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c3'),
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000c6');

insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3'),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e4'),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e3');
insert into memberships (user_id, company_id, role_id)
  select '00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000d1', id from roles where is_system;

-- bruno=c3, ana=c2, caio=c4, dani=c5 (só em naia)

insert into pipelines (id, company_id, name) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-funil-volt'),
  ('00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000d1', 'tst-funil-volt-b'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d2', 'tst-funil-naia');
insert into stages (id, pipeline_id, company_id, name, position) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-volt', 0),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000a8', '00000000-0000-4000-8000-0000000000d1', 'tst-etapa-volt-b', 0),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000d2', 'tst-etapa-naia', 0);
insert into products (id, company_id, name, kind) values
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000d1', 'tst-produto-volt', 'recurring'),
  ('00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000d2', 'tst-produto-naia', 'setup');
insert into lost_reasons (id, company_id, name) values
  ('00000000-0000-4000-8000-0000000000a6', '00000000-0000-4000-8000-0000000000d1', 'tst-motivo-volt'),
  ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-4000-8000-0000000000d2', 'tst-motivo-naia');
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, created_by) values
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c3', 'Neg Bruno', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c3'),
  ('00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Neg Ana', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c2'),
  ('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c4', 'Neg Caio', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c4'),
  ('00000000-0000-4000-8000-000000000d04', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c5', 'Neg Dani', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c5');
insert into deal_items (id, deal_id, company_id, product_id, quantity, unit_price) values
  ('00000000-0000-4000-8000-000000000e01', '00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a4', 1, 100),
  ('00000000-0000-4000-8000-000000000e03', '00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a4', 1, 300);
insert into deal_revenue_schedule (deal_id, company_id, month, mrr) values
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000d1', '2026-07-01', 100),
  ('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-0000000000d1', '2026-07-01', 300);
insert into deal_stage_history (deal_id, company_id, to_stage_id) values
  ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1'),
  ('00000000-0000-4000-8000-000000000d03', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1');
insert into custom_field_defs (company_id, entity, key, label, type, options) values
  ('00000000-0000-4000-8000-0000000000d1', 'deals', 'canal', 'Canal', 'select', '["Indicação","Outbound"]');
insert into notes (id, company_id, entity, record_id, body, created_by) values
  ('00000000-0000-4000-8000-000000000f01', '00000000-0000-4000-8000-0000000000d1', 'deals', '00000000-0000-4000-8000-000000000d03', 'Nota do negócio do caio', '00000000-0000-4000-8000-0000000000c1');

-- Restrições de integridade do Task 1 (como superusuário)
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c4','X','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b3') $$,
  null, 'OXYN_CROSS_COMPANY', 'etapa da mesma empresa mas de outro funil é rejeitada');
select throws_ok($$ update deals set lost_reason_id = '00000000-0000-4000-8000-0000000000a7' where id = '00000000-0000-4000-8000-000000000d03' $$,
  null, 'OXYN_CROSS_COMPANY', 'motivo de perda de outra empresa é rejeitado');
select throws_ok($$ update deal_items set kind = 'setup' where id = '00000000-0000-4000-8000-000000000e01' $$,
  null, 'OXYN_FORBIDDEN_FIELD', 'tipo do item não muda depois de criado');

-- Visibilidade
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select results_eq($$ select id from deals where company_id in ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000d2') $$,
  $$ values ('00000000-0000-4000-8000-000000000d01'::uuid) $$, 'bruno vê só o próprio negócio');
select throws_ok($$ select * from record_ref('deals', '00000000-0000-4000-8000-000000000d01') $$, '42501', null, 'authenticated não executa record_ref');
select is(can_read_record('deals', '00000000-0000-4000-8000-000000000d01'), true, 'bruno lê o negócio dele');
select is(can_read_record('deals', '00000000-0000-4000-8000-000000000d03'), false, 'bruno não lê negócio de caio');
select is(can_edit_record('deals', '00000000-0000-4000-8000-000000000d02'), false, 'bruno não edita negócio de ana');
select results_eq($$ select id from notes where entity = 'deals' $$, $$ select null::uuid where false $$, 'bruno não lê notas de negócio que não lê');
select throws_ok($$ insert into notes (company_id, entity, record_id, body) values ('00000000-0000-4000-8000-0000000000d1','deals','00000000-0000-4000-8000-000000000d03','x') $$,
  '42501', null, 'bruno não cria nota em negócio que não lê');
select lives_ok($$ insert into notes (company_id, entity, record_id, body) values ('00000000-0000-4000-8000-0000000000d1','deals','00000000-0000-4000-8000-000000000d01','ok') $$,
  'bruno cria nota em negócio que lê');
-- criação
select lives_ok($$ insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-000000000d05','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c3','Novo do bruno','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1') $$, 'bruno cria negócio próprio');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c2','Para ana','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'bruno não cria negócio para outro dono');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id, created_by) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c3','Autor falso','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000c2') $$, '42501', null, 'insert não aceita created_by de outro');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id, deleted_at) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c3','Na lixeira','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1', now()) $$, '42501', null, 'insert não cria negócio já na lixeira');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-0000000000d2','00000000-0000-4000-8000-0000000000c3','Outra empresa','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000b2') $$, '42501', null, 'bruno não cria negócio em empresa sem acesso');
-- edição e guardas
select is(pg_temp.affected($q$update deals set title = 'Neg Bruno 2' where id = '00000000-0000-4000-8000-000000000d01'$q$), 1::bigint, 'bruno edita o próprio negócio');
select is(pg_temp.affected($q$update deals set title = 'x' where id = '00000000-0000-4000-8000-000000000d02'$q$), 0::bigint, 'bruno não edita negócio que não vê');
select throws_ok($$ update deals set owner_id = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-000000000d01' $$, 'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'bruno não reatribui negócio');
select throws_ok($$ select reassign_record('deals', '00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000c2') $$, 'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'bruno não reatribui via RPC');
select throws_ok($$ update deals set deleted_at = now() where id = '00000000-0000-4000-8000-000000000d01' $$, 'P0001', 'OXYN_TRASH_FORBIDDEN', 'bruno não manda para a lixeira');
select throws_ok($$ update deals set company_id = '00000000-0000-4000-8000-0000000000d2' where id = '00000000-0000-4000-8000-000000000d01' $$, 'P0001', 'OXYN_COMPANY_IMMUTABLE', 'empresa do negócio é imutável');
select throws_ok($$ update deals set created_by = '00000000-0000-4000-8000-0000000000c2' where id = '00000000-0000-4000-8000-000000000d01' $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'created_by é imutável');
select throws_ok($$ update deals set custom_fields = '{"canal":"Nenhum"}' where id = '00000000-0000-4000-8000-000000000d01' $$, 'P0001', 'OXYN_INVALID_CUSTOM_FIELD', 'campo personalizado inválido é rejeitado');
select lives_ok($$ update deals set custom_fields = '{"canal":"Outbound"}' where id = '00000000-0000-4000-8000-000000000d01' $$, 'campo personalizado válido é aceito');
select is(pg_temp.affected($q$delete from deals where id = '00000000-0000-4000-8000-000000000d01'$q$), 0::bigint, 'bruno não exclui definitivamente');
-- itens
select is((select count(*) from deal_items where id in ('00000000-0000-4000-8000-000000000e01','00000000-0000-4000-8000-000000000e03')), 1::bigint, 'bruno vê só itens de negócio que lê');
select lives_ok($$ insert into deal_items (deal_id, company_id, product_id, quantity, unit_price) values ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000a4',2,50) $$,
  'bruno inclui item no negócio que edita');
select throws_ok($$ insert into deal_items (deal_id, company_id, product_id, quantity, unit_price) values ('00000000-0000-4000-8000-000000000d03','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000a4',2,50) $$,
  '42501', null, 'bruno não inclui item em negócio que não edita');
select throws_ok($$ update deal_items set kind = 'setup' where id = '00000000-0000-4000-8000-000000000e01' $$, 'P0001', 'OXYN_FORBIDDEN_FIELD', 'bruno não muda o tipo do item');
select is(pg_temp.affected($q$update deal_items set quantity = 3 where id = '00000000-0000-4000-8000-000000000e03'$q$), 0::bigint, 'bruno não edita item de negócio que não vê');
select is(pg_temp.affected($q$delete from deal_items where id = '00000000-0000-4000-8000-000000000e01'$q$), 1::bigint, 'bruno remove item do negócio que edita');
-- cronograma e histórico
select is((select count(*) from deal_revenue_schedule where deal_id in ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-000000000d03')), 1::bigint, 'bruno vê cronograma só de negócio que lê');
select is((select count(*) from deal_stage_history where deal_id in ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-000000000d03')), 1::bigint, 'bruno vê histórico só de negócio que lê');
select throws_ok($$ insert into deal_revenue_schedule (deal_id, company_id, month, mrr) values ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-0000000000d1','2026-08-01',1) $$,
  '42501', null, 'bruno não insere no cronograma');
select throws_ok($$ update deal_revenue_schedule set mrr = 1 where deal_id = '00000000-0000-4000-8000-000000000d01' $$, '42501', null, 'bruno não altera cronograma');
select throws_ok($$ delete from deal_revenue_schedule where deal_id = '00000000-0000-4000-8000-000000000d01' $$, '42501', null, 'bruno não apaga cronograma');
select throws_ok($$ insert into deal_stage_history (deal_id, company_id, to_stage_id) values ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000b1') $$,
  '42501', null, 'bruno não insere no histórico');
-- funis, etapas, motivos, produtos
select is((select count(*) from pipelines where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2')), 1::bigint, 'bruno vê funis da empresa dele');
select is((select count(*) from stages where id in ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000b2')), 1::bigint, 'bruno vê etapas da empresa dele');
select is((select count(*) from products where id in ('00000000-0000-4000-8000-0000000000a4','00000000-0000-4000-8000-0000000000a5')), 1::bigint, 'bruno vê produtos da empresa dele');
select is((select count(*) from lost_reasons where id in ('00000000-0000-4000-8000-0000000000a6','00000000-0000-4000-8000-0000000000a7')), 1::bigint, 'bruno vê motivos da empresa dele');
select throws_ok($$ insert into pipelines (company_id, name) values ('00000000-0000-4000-8000-0000000000d1','tst-novo') $$, '42501', null, 'bruno não cria funil');
select throws_ok($$ insert into stages (pipeline_id, company_id, name, position) values ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000d1','tst-e',9) $$, '42501', null, 'bruno não cria etapa');
select throws_ok($$ insert into lost_reasons (company_id, name) values ('00000000-0000-4000-8000-0000000000d1','tst-m') $$, '42501', null, 'bruno não cria motivo de perda');
select throws_ok($$ insert into products (company_id, name, kind) values ('00000000-0000-4000-8000-0000000000d1','tst-p','setup') $$, '42501', null, 'bruno não cria produto');
select is(pg_temp.affected($q$update products set name = 'tst-hack' where id = '00000000-0000-4000-8000-0000000000a4'$q$), 0::bigint, 'bruno não edita produto');
select is(can_manage_pipelines('00000000-0000-4000-8000-0000000000d1'), false, 'bruno não gerencia funis');
select is(can_manage_products('00000000-0000-4000-8000-0000000000d1'), false, 'bruno não gerencia produtos');

-- ana (equipe)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select results_eq($$ select id from deals where company_id = '00000000-0000-4000-8000-0000000000d1' order by title $$,
  $$ values ('00000000-0000-4000-8000-000000000d02'::uuid), ('00000000-0000-4000-8000-000000000d01'::uuid), ('00000000-0000-4000-8000-000000000d05'::uuid) $$, 'ana vê negócios dela e de bruno, não de caio');
select throws_ok($$ update deals set owner_id = '00000000-0000-4000-8000-0000000000c3' where id = '00000000-0000-4000-8000-000000000d02' $$, 'P0001', 'OXYN_REASSIGN_FORBIDDEN', 'ana não reatribui');
select is(can_manage_pipelines('00000000-0000-4000-8000-0000000000d1'), false, 'ana não gerencia funis');

-- eva (equipe com reatribuição)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c6');
select lives_ok($$ select reassign_record('deals', '00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-0000000000c2') $$, 'eva reatribui negócio da equipe');

-- caio (gestor)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c4');
select is((select count(*) from deals where id in ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-000000000d02','00000000-0000-4000-8000-000000000d03','00000000-0000-4000-8000-000000000d04')), 3::bigint, 'caio vê todos os negócios de tst-volt e nenhum de tst-naia');
select is((select owner_id from deals where id = '00000000-0000-4000-8000-000000000d01'), '00000000-0000-4000-8000-0000000000c2'::uuid, 'reatribuição da eva valeu');
select lives_ok($$ select reassign_record('deals', '00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-0000000000c3') $$, 'caio reatribui via reassign_record');
select throws_ok($$ select reassign_record('deals', '00000000-0000-4000-8000-000000000d02', '00000000-0000-4000-8000-0000000000c5') $$, 'P0001', 'OXYN_OWNER_NOT_MEMBER', 'caio não reatribui para quem não é da empresa');
select lives_ok($$ insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-000000000d06','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c2','Caio para ana','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1') $$, 'caio cria negócio para ana');
select throws_ok($$ insert into deals (company_id, owner_id, title, pipeline_id, stage_id) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c5','Para dani','00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1') $$, '42501', null, 'caio não cria negócio para quem não é da empresa');
select lives_ok($$ update deals set custom_fields = '{"canal":"Indicação"}' where id = '00000000-0000-4000-8000-000000000d03' $$, 'caio grava campo personalizado válido');
select is(can_manage_pipelines('00000000-0000-4000-8000-0000000000d1'), true, 'caio gerencia funis');
select is(can_manage_products('00000000-0000-4000-8000-0000000000d1'), true, 'caio gerencia produtos');
select is(can_manage_pipelines('00000000-0000-4000-8000-0000000000d2'), false, 'caio não gerencia funis de outra empresa');
select lives_ok($$ insert into pipelines (id, company_id, name) values ('00000000-0000-4000-8000-0000000000a9','00000000-0000-4000-8000-0000000000d1','tst-funil-caio') $$, 'caio cria funil');
select lives_ok($$ insert into stages (pipeline_id, company_id, name, position) values ('00000000-0000-4000-8000-0000000000a9','00000000-0000-4000-8000-0000000000d1','tst-etapa-caio',0) $$, 'caio cria etapa');
select lives_ok($$ insert into lost_reasons (company_id, name) values ('00000000-0000-4000-8000-0000000000d1','tst-motivo-caio') $$, 'caio cria motivo de perda');
select lives_ok($$ insert into products (company_id, name, kind) values ('00000000-0000-4000-8000-0000000000d1','tst-produto-caio','setup') $$, 'caio cria produto');
select throws_ok($$ insert into pipelines (company_id, name) values ('00000000-0000-4000-8000-0000000000d2','tst-fora') $$, '42501', null, 'caio não cria funil em outra empresa');
select throws_ok($$ delete from pipelines where id = '00000000-0000-4000-8000-0000000000a1' $$, '23503', null, 'funil com negócios não é excluído');
select throws_ok($$ delete from stages where id = '00000000-0000-4000-8000-0000000000b1' $$, '23503', null, 'etapa com negócios não é excluída');
select throws_ok($$ update stages set pipeline_id = '00000000-0000-4000-8000-0000000000a8' where id = '00000000-0000-4000-8000-0000000000b1' $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'caio não move etapa para outro funil');
select throws_ok($$ update deal_items set deal_id = '00000000-0000-4000-8000-000000000d02' where id = '00000000-0000-4000-8000-000000000e03' $$,
  'P0001', 'OXYN_FORBIDDEN_FIELD', 'caio não move item para outro negócio');
select lives_ok($$ delete from pipelines where id = '00000000-0000-4000-8000-0000000000a8' $$, 'funil sem negócios é excluído');
select throws_ok($$ insert into deal_revenue_schedule (deal_id, company_id, month, mrr) values ('00000000-0000-4000-8000-000000000d03','00000000-0000-4000-8000-0000000000d1','2026-08-01',1) $$,
  '42501', null, 'nem o gestor escreve no cronograma');
-- lixeira
select is(pg_temp.affected($q$update deals set deleted_at = now() where id = '00000000-0000-4000-8000-000000000d03'$q$), 1::bigint, 'caio manda negócio para a lixeira');
select is((select count(*) from deals where id = '00000000-0000-4000-8000-000000000d03'), 1::bigint, 'caio ainda vê o negócio na lixeira');
select is(can_read_record('deals', '00000000-0000-4000-8000-000000000d03'), false, 'negócio na lixeira não é lido como registro ativo');
select is(pg_temp.affected($q$delete from deals where id = '00000000-0000-4000-8000-000000000d03'$q$), 0::bigint, 'caio não exclui definitivamente');
select throws_ok($$ select purge_record('deals', '00000000-0000-4000-8000-000000000d03') $$, '42501', null, 'caio não usa purge_record');
select is((select count(*) from deal_items where deal_id = '00000000-0000-4000-8000-000000000d03'), 0::bigint, 'itens de negócio na lixeira ficam ocultos');

-- bruno não vê a lixeira
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3');
select is((select count(*) from deals where id = '00000000-0000-4000-8000-000000000d03'), 0::bigint, 'bruno não vê negócio na lixeira');

-- dani (outra empresa)
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c5');
select results_eq($$ select id from deals where id in ('00000000-0000-4000-8000-000000000d01','00000000-0000-4000-8000-000000000d02','00000000-0000-4000-8000-000000000d03','00000000-0000-4000-8000-000000000d04') $$, $$ values ('00000000-0000-4000-8000-000000000d04'::uuid) $$, 'dani vê só negócio da empresa dela');
select is((select count(*) from pipelines where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2')), 1::bigint, 'dani vê só funis da empresa dela');
select is((select count(*) from deal_items where id = '00000000-0000-4000-8000-000000000e01'), 0::bigint, 'dani não vê itens de outra empresa');

-- admin geral: exclusão definitiva
select pg_temp.as_pg();
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
select throws_ok($$ select purge_record('deals', '00000000-0000-4000-8000-000000000d01') $$, 'P0001', 'OXYN_TRASH_FORBIDDEN', 'purge_record exige negócio na lixeira');
select lives_ok($$ select purge_record('deals', '00000000-0000-4000-8000-000000000d03') $$, 'admin exclui definitivamente negócio da lixeira');
select pg_temp.as_pg();
select is((select count(*) from deals where id = '00000000-0000-4000-8000-000000000d03'), 0::bigint, 'negócio foi removido');
select is((select count(*) from notes where entity = 'deals' and record_id = '00000000-0000-4000-8000-000000000d03'), 0::bigint, 'notas do negócio foram removidas');
select is((select count(*) from deal_items where deal_id = '00000000-0000-4000-8000-000000000d03'), 0::bigint, 'itens do negócio foram removidos');
select is((select count(*) from deal_revenue_schedule where deal_id = '00000000-0000-4000-8000-000000000d03'), 0::bigint, 'cronograma do negócio foi removido');
select is(has_function_privilege('anon', 'public.can_manage_pipelines(uuid)', 'execute'), false, 'anon não executa can_manage_pipelines');
select is(has_function_privilege('authenticated', 'public.can_manage_products(uuid)', 'execute'), true, 'authenticated executa can_manage_products');

select * from finish();
rollback;
