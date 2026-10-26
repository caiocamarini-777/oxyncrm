begin;
select plan(11);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
grant execute on function pg_temp.u(int) to public;

insert into import_jobs (id, source, status, counters) values
  (pg_temp.u(801), 'pipedrive', 'running', '{"persons": {"errors": 2}}');

-- 1. Permissões ---------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.import_count(uuid, text, jsonb)', 'execute'),
  'service_role executa import_count');
select ok(has_function_privilege('service_role', 'public.import_log_items(uuid, jsonb)', 'execute'),
  'service_role executa import_log_items');
select ok(not has_function_privilege('authenticated', 'public.import_count(uuid, text, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.import_count(uuid, text, jsonb)', 'execute'),
  'authenticated e anon não executam import_count');
select ok(not has_function_privilege('authenticated', 'public.import_log_items(uuid, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.import_log_items(uuid, jsonb)', 'execute'),
  'authenticated e anon não executam import_log_items');

-- 2. import_count soma sem apagar errors ----------------------------------------------------------------
set local role service_role;
select public.import_count(pg_temp.u(801), 'persons', '{"created": 3, "updated": 1, "errors": 99}');
select public.import_count(pg_temp.u(801), 'persons', '{"created": 2, "unchanged": 4}');
select public.import_count(pg_temp.u(801), 'deals', '{"skipped": 1}');
reset role;
select is((select counters->'persons' from import_jobs where id = pg_temp.u(801)),
  '{"errors": 2, "created": 5, "updated": 1, "unchanged": 4}'::jsonb,
  'import_count acumula por entidade, ignora errors e preserva o que o banco contou');
select is((select counters->'deals' from import_jobs where id = pg_temp.u(801)), '{"skipped": 1}'::jsonb,
  'import_count cria a entidade ausente');
select throws_ok($$ select public.import_count(pg_temp.u(801), 'persons', '[]') $$, 'OXYN_IMPORT_INVALID_ROWS',
  'import_count recusa contagens que não são objeto');

-- 3. import_log_items separa avisos e erros -------------------------------------------------------------
set local role service_role;
select is(public.import_log_items(pg_temp.u(801), '[
  {"entity": "persons", "external_id": "7", "reason": "pessoa sem nome"},
  {"entity": "persons", "external_id": "8", "reason": "aviso: campo x descartado"},
  {"entity": "job", "reason": "Token inválido"},
  5
]'::jsonb), 3, 'import_log_items registra os itens objeto');
reset role;
select is((select counters->'persons' from import_jobs where id = pg_temp.u(801)),
  '{"errors": 3, "created": 5, "updated": 1, "unchanged": 4, "warnings": 1}'::jsonb,
  'erros e avisos dos mapeadores entram nos contadores certos');
select is((select jsonb_build_array(jsonb_array_length(errors), jsonb_array_length(warnings), warnings->0->>'external_id')
             from import_jobs where id = pg_temp.u(801)),
  '[2, 1, "8"]'::jsonb, 'erros vão para errors e avisos para warnings');
select throws_ok($$ select public.import_log_items(pg_temp.u(801), '{}') $$, 'OXYN_IMPORT_INVALID_ROWS',
  'import_log_items recusa o que não é lista');

select * from finish();
rollback;
