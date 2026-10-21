begin;
select plan(24);

select has_table('public', t, t || ' existe')
from unnest(array['organizations','persons','lead_sources','disqualification_reasons','leads',
  'labels','record_labels','custom_field_defs','notes','timeline_events']) t;

insert into companies (id, name, slug) values
  ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt'),
  ('00000000-0000-4000-8000-0000000000d2', 'Naia Teste', 'tst-naia');

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-admin@oxyn.test', '{"full_name":"admin"}');

insert into persons (id, company_id, owner_id, full_name) values
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000c1', 'Pessoa Naia');

select throws_ok($$ insert into organizations (company_id, owner_id, name, cnpj) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','Org','12.345.678/0001-95') $$,
  '23514', null, 'cnpj mascarado é rejeitado');
select throws_ok($$ insert into organizations (company_id, owner_id, name, domain) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','Org','Volt.com') $$,
  '23514', null, 'domínio com maiúscula é rejeitado');
select throws_ok($$ insert into leads (company_id, owner_id, title, status) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','Lead','disqualified') $$,
  '23514', null, 'lead desqualificado exige motivo');
select throws_ok($$ insert into labels (company_id, name, color) values
  ('00000000-0000-4000-8000-0000000000d1','Quente','orange') $$,
  '23514', null, 'cor de label fora da paleta é rejeitada');
select throws_ok($$ insert into custom_field_defs (company_id, entity, key, label, type) values
  ('00000000-0000-4000-8000-0000000000d1','leads','porte','Porte','select') $$,
  '23514', null, 'campo select exige opções');
select throws_ok($$ insert into custom_field_defs (company_id, entity, key, label, type) values
  ('00000000-0000-4000-8000-0000000000d1','leads','Valor','Valor','text') $$,
  '23514', null, 'key com maiúscula é rejeitada');

select lives_ok($$ insert into persons (id, company_id, owner_id, full_name, emails, phones) values
  ('00000000-0000-4000-8000-000000000a01','00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','Ana',
   '[{"label":"Trabalho","value":" Ana@Volt.COM "}]', '[{"label":"Celular","value":"(11) 98888-7777"}]') $$,
  'pessoa com contatos sujos é inserida');
select results_eq($$ select emails->0->>'value' from persons where id = '00000000-0000-4000-8000-000000000a01' $$,
  $$ values ('ana@volt.com') $$, 'e-mail normalizado');
select results_eq($$ select phones->0->>'value' from persons where id = '00000000-0000-4000-8000-000000000a01' $$,
  $$ values ('11988887777') $$, 'telefone só com dígitos');

select throws_ok($$ insert into leads (company_id, owner_id, title, person_id) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','Lead','00000000-0000-4000-8000-000000000a02') $$,
  null, 'OXYN_CROSS_COMPANY', 'lead não referencia pessoa de outra empresa');

insert into organizations (company_id, owner_id, name, cnpj) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','Org 1','12345678000195');
select throws_ok($$ insert into organizations (company_id, owner_id, name, cnpj) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','Org 2','12345678000195') $$,
  '23505', null, 'cnpj duplicado na mesma empresa');
update organizations set deleted_at = now() where name = 'Org 1' and company_id = '00000000-0000-4000-8000-0000000000d1';
select lives_ok($$ insert into organizations (company_id, owner_id, name, cnpj) values
  ('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000c1','Org 2','12345678000195') $$,
  'cnpj liberado após exclusão lógica');

insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000d3', 'Nova Teste', 'tst-nova');
select is((select count(*) from lead_sources where company_id = '00000000-0000-4000-8000-0000000000d3'), 6::bigint, 'empresa nova recebe 6 origens');
select is((select count(*) from disqualification_reasons where company_id = '00000000-0000-4000-8000-0000000000d3'), 6::bigint, 'empresa nova recebe 6 motivos');

select * from finish();
rollback;
