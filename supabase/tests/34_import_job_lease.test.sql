begin;
select plan(14);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
grant execute on function pg_temp.u(int) to public;

insert into import_jobs (id, source, status) values
  (pg_temp.u(901), 'pipedrive', 'running'),
  (pg_temp.u(902), 'pipedrive', 'paused'),
  (pg_temp.u(903), 'pipedrive', 'draft');

-- 1. Colunas e permissões ----------------------------------------------------------------------------
select has_column('public', 'import_jobs', 'lease_owner', 'import_jobs.lease_owner existe');
select has_column('public', 'import_jobs', 'lease_until', 'import_jobs.lease_until existe');
select ok(has_function_privilege('service_role', 'public.import_claim(uuid, uuid, int)', 'execute')
      and has_function_privilege('service_role', 'public.import_release(uuid, uuid)', 'execute'),
  'service_role executa import_claim e import_release');
select ok(not has_function_privilege('authenticated', 'public.import_claim(uuid, uuid, int)', 'execute')
      and not has_function_privilege('anon', 'public.import_claim(uuid, uuid, int)', 'execute')
      and not has_function_privilege('authenticated', 'public.import_release(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.import_release(uuid, uuid)', 'execute'),
  'authenticated e anon não executam as funções de concessão');

-- 2. Concessão ---------------------------------------------------------------------------------------
set local role service_role;
select ok(public.import_claim(pg_temp.u(901), pg_temp.u(1), 120), 'concessão livre é tomada');
select ok(not public.import_claim(pg_temp.u(901), pg_temp.u(2), 120), 'outra fatia não toma concessão vigente');
select ok(public.import_claim(pg_temp.u(901), pg_temp.u(1), 120), 'o dono renova a própria concessão');
select public.import_release(pg_temp.u(901), pg_temp.u(2));
reset role;
select is((select lease_owner from import_jobs where id = pg_temp.u(901)), pg_temp.u(1),
  'quem não é dono não libera');
update import_jobs set lease_until = now() - interval '1 second' where id = pg_temp.u(901);
set local role service_role;
select ok(public.import_claim(pg_temp.u(901), pg_temp.u(2), 120), 'concessão vencida é tomada por outra fatia');
select public.import_release(pg_temp.u(901), pg_temp.u(2));
reset role;
select ok((select lease_owner is null and lease_until is null from import_jobs where id = pg_temp.u(901)),
  'o dono libera a concessão');
set local role service_role;
select ok(not public.import_claim(pg_temp.u(902), pg_temp.u(1), 120), 'job pausado não é tomado');
select ok(public.import_claim(pg_temp.u(903), pg_temp.u(1), 120), 'job em rascunho é tomado');
select throws_ok($$ select public.import_claim(pg_temp.u(901), pg_temp.u(1), 0) $$, 'OXYN_IMPORT_INVALID_LEASE',
  'duração inválida é recusada');
select ok(not public.import_claim(pg_temp.u(999), pg_temp.u(1), 120), 'job inexistente não é tomado');
reset role;

select * from finish();
rollback;
