begin;
select plan(7);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid) to public;

insert into companies (id, name, slug) values (pg_temp.u(1), 'Selo Teste', 'tst-selo');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-selo@oxyn.test', '{"full_name":"selo"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-Selo', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values (pg_temp.u(11), pg_temp.u(1), pg_temp.u(21));
insert into pipelines (id, company_id, name) values (pg_temp.u(401), pg_temp.u(1), 'tst-funil-selo');
insert into stages (id, pipeline_id, company_id, name, position) values (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-e', 0);
insert into deals (id, company_id, owner_id, title, pipeline_id, stage_id, created_by)
select pg_temp.u(200 + n), pg_temp.u(1), pg_temp.u(11), 'tst-neg-' || n, pg_temp.u(401), pg_temp.u(501), pg_temp.u(11)
from generate_series(1, 5) n;
insert into leads (id, company_id, owner_id, title, created_by) values
  (pg_temp.u(101), pg_temp.u(1), pg_temp.u(11), 'tst-lead-selo', pg_temp.u(11)),
  (pg_temp.u(102), pg_temp.u(1), pg_temp.u(11), 'tst-lead-sem', pg_temp.u(11));

create function pg_temp.mk(n int, ch text, p_lead uuid, p_deal uuid, p_due timestamptz, p_done boolean default false, p_deleted boolean default false)
returns void language plpgsql as $$
begin
  insert into activities (id, company_id, owner_id, created_by, type_id, channel_id, subject, due_at, lead_id, deal_id,
    done, completed_at, outcome_id, deleted_at)
  values (pg_temp.u(n), pg_temp.u(1), pg_temp.u(11), pg_temp.u(11),
    (select id from activity_types where company_id = pg_temp.u(1) order by position limit 1),
    (select id from activity_channels where company_id = pg_temp.u(1) and name = ch),
    'tst-ativ-' || n, p_due, p_lead, p_deal, p_done,
    case when p_done then p_due end,
    case when p_done then (select id from activity_outcomes where company_id = pg_temp.u(1) order by position limit 1) end,
    case when p_deleted then now() end);
end $$;
grant execute on function pg_temp.mk(int, text, uuid, uuid, timestamptz, boolean, boolean) to public;

-- negócios: 201 atrasada aberta, 202 futura, 203 atrasada concluída, 204 atrasada na lixeira, 205 sem atividade
select pg_temp.mk(301, 'E-mail', null, pg_temp.u(201), now() - interval '2 hours');
select pg_temp.mk(302, 'E-mail', null, pg_temp.u(202), now() + interval '2 days');
select pg_temp.mk(303, 'E-mail', null, pg_temp.u(203), now() - interval '2 days', true);
select pg_temp.mk(304, 'E-mail', null, pg_temp.u(204), now() - interval '2 days', false, true);
-- leads: concluída antiga (E-mail) e mais recente (LinkedIn); aberta de outro canal não conta
select pg_temp.mk(311, 'E-mail', pg_temp.u(101), null, now() - interval '3 days', true);
select pg_temp.mk(312, 'LinkedIn', pg_temp.u(101), null, now() - interval '1 day', true);
select pg_temp.mk(313, 'WhatsApp', pg_temp.u(101), null, now() + interval '1 day');

select pg_temp.as_user(pg_temp.u(11));

select is((select array_agg(id order by id) from deals d where d.company_id = pg_temp.u(1) and has_overdue_activity(d)),
  array[pg_temp.u(201)], 'has_overdue_activity: só atrasada aberta e não excluída');
select is((select has_overdue_activity(d) from deals d where d.id = pg_temp.u(202)), false, 'futura não conta');
select is((select has_overdue_activity(d) from deals d where d.id = pg_temp.u(205)), false, 'sem atividade não conta');
select is((select count(*)::int from deals_with_labels('{}') d where d.company_id = pg_temp.u(1) and has_overdue_activity(d)), 1,
  'computado funciona sobre setof deals (rpc)');
select is((select channel_name from last_channel_for(array[pg_temp.u(101)])), 'LinkedIn', 'último canal: concluída mais recente');
select is((select count(*)::int from last_channel_for(array[pg_temp.u(102)])), 0, 'lead sem concluída não retorna linha');
select is((select count(*)::int from last_channel_for(array[pg_temp.u(101), pg_temp.u(102)])), 1, 'uma linha por lead');

select * from finish();
rollback;
