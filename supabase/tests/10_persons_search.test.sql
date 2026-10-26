begin;
select plan(11);

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
grant execute on function pg_temp.as_user(uuid), pg_temp.as_pg() to public;

insert into companies (id, name, slug) values ('00000000-0000-4000-8000-0000000000d1', 'Volt Teste', 'tst-volt');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-ana@oxyn.test', '{"full_name":"tst Ana"}');
insert into roles (id, name, description, permissions) values
  ('00000000-0000-4000-8000-0000000000e3', 'tst-Gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e3');

insert into persons (id, company_id, owner_id, full_name, job_title, emails, phones) values
  ('00000000-0000-4000-8000-000000000a01', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2',
   'Ana Souza', 'Diretora', '[{"label":"Trabalho","value":"Ana@Volt.com"},{"value":"ana.p@casa.com"}]',
   '[{"label":"Celular","value":"+55 (11) 99999-0000"},{"value":"11 3333-4444"}]');

select is((select phones->0->>'value' from persons where id = '00000000-0000-4000-8000-000000000a01'), '11999990000', '+55 vira forma nacional');
select is((select phones->1->>'value' from persons where id = '00000000-0000-4000-8000-000000000a01'), '1133334444', 'forma nacional continua igual');
select is((select search_text from persons where id = '00000000-0000-4000-8000-000000000a01'),
  'ana souza diretora ana@volt.com ana.p@casa.com 11999990000 1133334444', 'search_text reúne nome, cargo, e-mails e telefones');

update persons set job_title = 'Gerente', emails = '[{"value":"NOVO@x.com"}]', phones = '[{"value":"5521988887777"}]'
  where id = '00000000-0000-4000-8000-000000000a01';
select is((select search_text from persons where id = '00000000-0000-4000-8000-000000000a01'),
  'ana souza gerente novo@x.com 21988887777', 'search_text acompanha o update');
select is((select phones->0->>'value' from persons where id = '00000000-0000-4000-8000-000000000a01'), '21988887777', '13 dígitos com 55 normaliza no update');

insert into persons (id, company_id, owner_id, full_name, phones) values
  ('00000000-0000-4000-8000-000000000a02', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000c2', 'Cinquenta', '[{"value":"55999990000"}]');
select is((select phones->0->>'value' from persons where id = '00000000-0000-4000-8000-000000000a02'), '55999990000', '11 dígitos com DDD 55 é preservado');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000c2');
select is((select count(*) from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', '{}', array['5521988887777']) where matched_on = 'phone'), 1::bigint, 'duplicidade com +55 acha a forma nacional');
select is((select count(*) from check_duplicates('00000000-0000-4000-8000-0000000000d1', 'persons', '{}', array['(21) 98888-7777']) where matched_on = 'phone'), 1::bigint, 'duplicidade com forma nacional acha');
select is((select count(*) from persons where search_text like '%novo@x.com%'), 1::bigint, 'busca por e-mail em search_text');

select pg_temp.as_pg();
select is((select count(*) from timeline_events where record_id = '00000000-0000-4000-8000-000000000a01' and kind = 'updated' and data->'fields' ? 'search_text'), 0::bigint, 'search_text não aparece na timeline');
select is((select count(*) from pg_indexes where indexname = 'persons_search_trgm'), 1::bigint, 'índice trigram existe');

select * from finish();
rollback;
