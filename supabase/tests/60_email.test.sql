begin;
select plan(46);

create function pg_temp.u(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
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
create function pg_temp.cnt(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || stmt || ') x' into n;
  return n;
end $$;
grant execute on function pg_temp.u(int), pg_temp.as_user(uuid), pg_temp.as_anon(), pg_temp.as_pg(),
  pg_temp.affected(text), pg_temp.cnt(text) to public;

-- Cenário: 11 = vendedor dono das caixas (só vê o que é dele), 12 = gestor (vê a empresa toda),
-- 13 = outro vendedor da empresa, 14 = usuário só da outra empresa.
insert into companies (id, name, slug) values
  (pg_temp.u(1), 'Mail Teste', 'tst-mail'),
  (pg_temp.u(2), 'Mail Outra', 'tst-mail2');
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
  (pg_temp.u(11), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-em-dono@oxyn.test', '{"full_name":"tst-dono"}'),
  (pg_temp.u(12), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-em-gestor@oxyn.test', '{"full_name":"tst-gestor"}'),
  (pg_temp.u(13), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-em-outro@oxyn.test', '{"full_name":"tst-outro"}'),
  (pg_temp.u(14), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tst-em-fora@oxyn.test', '{"full_name":"tst-fora"}');
insert into roles (id, name, description, permissions) values
  (pg_temp.u(21), 'tst-em-gestor', 'teste', '{"visibility":{"leads":"company","deals":"company","persons":"company","organizations":"company","activities":"company"},"actions":{"create":true,"edit":true,"delete":true,"export":true,"reassign_owner":true},"settings":{"manage_pipelines":true,"manage_custom_fields":true,"manage_products":true,"view_reports":true,"create_dashboards":true,"share_dashboards":true}}'::jsonb),
  (pg_temp.u(22), 'tst-em-vend', 'teste', '{"visibility":{"leads":"own","deals":"own","persons":"own","organizations":"own","activities":"own"},"actions":{"create":true,"edit":true,"delete":false,"export":false,"reassign_owner":false},"settings":{"manage_pipelines":false,"manage_custom_fields":false,"manage_products":false,"view_reports":true,"create_dashboards":true,"share_dashboards":false}}'::jsonb);
insert into memberships (user_id, company_id, role_id) values
  (pg_temp.u(11), pg_temp.u(1), pg_temp.u(22)),
  (pg_temp.u(12), pg_temp.u(1), pg_temp.u(21)),
  (pg_temp.u(13), pg_temp.u(1), pg_temp.u(22)),
  (pg_temp.u(14), pg_temp.u(2), pg_temp.u(21));

insert into organizations (id, company_id, owner_id, name) values
  (pg_temp.u(301), pg_temp.u(1), pg_temp.u(11), 'tst-Org Mail');
insert into persons (id, company_id, owner_id, full_name) values
  (pg_temp.u(311), pg_temp.u(1), pg_temp.u(11), 'tst-Pessoa do dono'),
  (pg_temp.u(312), pg_temp.u(1), pg_temp.u(13), 'tst-Pessoa do outro'),
  (pg_temp.u(313), pg_temp.u(2), pg_temp.u(14), 'tst-Pessoa de fora');

-- caixa compartilhada (A1) e caixa privada (A2), ambas do dono 11
insert into email_accounts (id, user_id, company_id, email, visibility) values
  (pg_temp.u(401), pg_temp.u(11), pg_temp.u(1), 'tst-dono@oxyn.test', 'shared'),
  (pg_temp.u(402), pg_temp.u(11), pg_temp.u(1), 'tst-dono-priv@oxyn.test', 'private');
insert into email_account_secrets (account_id, refresh_token_enc) values (pg_temp.u(401), 'tst-segredo');
insert into email_threads (id, account_id, company_id, gmail_thread_id, subject, last_message_at) values
  (pg_temp.u(501), pg_temp.u(401), pg_temp.u(1), 'tst-t1', 'Proposta', now()),
  (pg_temp.u(502), pg_temp.u(402), pg_temp.u(1), 'tst-t2', 'Conversa privada', now());
insert into email_messages (id, thread_id, account_id, gmail_message_id, from_email, sent_at, direction) values
  (pg_temp.u(601), pg_temp.u(501), pg_temp.u(401), 'tst-m1', 'cliente@exemplo.com', now(), 'in'),
  (pg_temp.u(602), pg_temp.u(502), pg_temp.u(402), 'tst-m2', 'cliente@exemplo.com', now(), 'in');
insert into email_links (id, thread_id, entity, record_id, origin) values
  (pg_temp.u(701), pg_temp.u(501), 'persons', pg_temp.u(311), 'auto'),
  (pg_temp.u(702), pg_temp.u(502), 'persons', pg_temp.u(311), 'auto');

-- Leitura de conversas ---------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select is((select count(*) from email_threads where id = pg_temp.u(501)), 1::bigint, 'dono lê a conversa da caixa compartilhada');
select is((select count(*) from email_threads where id = pg_temp.u(502)), 1::bigint, 'dono lê a conversa da caixa privada');
select is((select count(*) from email_messages), 2::bigint, 'dono lê as mensagens das duas caixas');

select pg_temp.as_user(pg_temp.u(12));
select is((select count(*) from email_threads where id = pg_temp.u(501)), 1::bigint, 'gestor com acesso ao card lê a conversa compartilhada');
select is((select count(*) from email_threads where id = pg_temp.u(502)), 0::bigint, 'gestor não lê a conversa da caixa privada');
select is((select count(*) from email_messages where thread_id = pg_temp.u(501)), 1::bigint, 'gestor lê a mensagem da caixa compartilhada');
select is((select count(*) from email_messages where thread_id = pg_temp.u(502)), 0::bigint, 'gestor não lê a mensagem da caixa privada');
select is((select count(*) from email_links), 1::bigint, 'gestor só vê o vínculo da conversa compartilhada');

select pg_temp.as_user(pg_temp.u(13));
select is((select count(*) from email_threads), 0::bigint, 'membro sem acesso ao card não lê a conversa');
select is((select count(*) from email_messages), 0::bigint, 'membro sem acesso ao card não lê as mensagens');
select is((select count(*) from email_links), 0::bigint, 'membro sem acesso ao card não vê o vínculo');

select pg_temp.as_user(pg_temp.u(14));
select is((select count(*) from email_threads), 0::bigint, 'usuário de outra empresa não lê a conversa');
select is((select count(*) from email_accounts), 0::bigint, 'usuário de outra empresa não vê as caixas');

-- Caixas -----------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select is((select count(*) from email_accounts), 2::bigint, 'dono vê as próprias caixas');
select pg_temp.as_user(pg_temp.u(12));
select is((select count(*) from email_accounts), 0::bigint, 'gestor não super admin não vê caixa alheia');
select pg_temp.as_pg();
update profiles set is_super_admin = true where id = pg_temp.u(12);
select pg_temp.as_user(pg_temp.u(12));
select is((select count(*) from email_accounts), 2::bigint, 'admin geral lê todas as caixas');
select pg_temp.as_pg();
update profiles set is_super_admin = false where id = pg_temp.u(12);

-- Segredos e escrita direta ----------------------------------------------------
select pg_temp.as_user(pg_temp.u(11));
select throws_ok($$select * from email_account_secrets$$, '42501', null, 'authenticated não lê os segredos');
select throws_ok($$insert into email_threads (account_id, company_id, gmail_thread_id) values ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000001', 'x')$$,
  '42501', null, 'authenticated não escreve conversas');
select throws_ok($$insert into email_links (thread_id, entity, record_id, origin) values ('00000000-0000-4000-8000-000000000501', 'organizations', '00000000-0000-4000-8000-000000000301', 'manual')$$,
  '42501', null, 'authenticated não escreve vínculos direto');
select throws_ok($$update email_accounts set status = 'reconnect'$$, '42501', null, 'dono só altera a visibilidade da caixa');
select pg_temp.as_anon();
select throws_ok($$select * from email_threads$$, '42501', null, 'anon não lê conversas');
select pg_temp.as_pg();
select ok(has_table_privilege('service_role', 'public.email_account_secrets', 'select, insert, update, delete'), 'service role acessa os segredos');
select ok(has_table_privilege('service_role', 'public.email_links', 'insert, update'), 'service role escreve vínculos');
select throws_ok($$insert into email_links (thread_id, entity, record_id, origin) values ('00000000-0000-4000-8000-000000000501', 'activities', '00000000-0000-4000-8000-000000000301', 'auto')$$,
  '23514', null, 'vínculo só aceita leads, deals, persons e organizations');

-- Vincular ---------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(12));
select throws_ok(format($$select public.email_link_thread(%L, 'organizations', %L)$$, pg_temp.u(501), pg_temp.u(301)),
  '42501', 'OXYN_EMAIL_FORBIDDEN', 'quem não é dono da caixa não vincula');
select pg_temp.as_user(pg_temp.u(11));
select throws_ok(format($$select public.email_link_thread(%L, 'persons', %L)$$, pg_temp.u(501), pg_temp.u(312)),
  '42501', 'OXYN_EMAIL_FORBIDDEN', 'dono não vincula a registro que não pode editar');
select throws_ok(format($$select public.email_link_thread(%L, 'persons', %L)$$, pg_temp.u(501), pg_temp.u(313)),
  '42501', 'OXYN_EMAIL_FORBIDDEN', 'dono não vincula a registro de outra empresa');
select throws_ok(format($$select public.email_link_thread(%L, 'activities', %L)$$, pg_temp.u(501), pg_temp.u(301)),
  'OXYN_INVALID_ENTITY', 'entidade inválida é recusada');
select isnt(public.email_link_thread(pg_temp.u(501), 'organizations', pg_temp.u(301)), null, 'dono vincula a conversa a um registro seu');
select is((select origin from email_links where thread_id = pg_temp.u(501) and entity = 'organizations'), 'manual', 'vínculo feito pelo dono é manual');
select is(public.email_link_thread(pg_temp.u(501), 'organizations', pg_temp.u(301)),
  (select id from email_links where thread_id = pg_temp.u(501) and entity = 'organizations'), 'vincular de novo não duplica o vínculo');

-- Desvincular ------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(13));
select throws_ok(format($$select public.email_unlink_thread(%L)$$, pg_temp.u(701)),
  '42501', 'OXYN_EMAIL_FORBIDDEN', 'quem não lê a conversa não desvincula');
select pg_temp.as_user(pg_temp.u(12));
select throws_ok(format($$select public.email_unlink_thread(%L)$$, pg_temp.u(702)),
  '42501', 'OXYN_EMAIL_FORBIDDEN', 'gestor não desvincula conversa de caixa privada');

-- remove o vínculo com a organização (criado acima) para isolar o efeito do vínculo com a pessoa
select pg_temp.as_user(pg_temp.u(11));
select lives_ok(format($$select public.email_unlink_thread(id) from email_links where thread_id = %L and entity = 'organizations'$$, pg_temp.u(501)),
  'dono desvincula');
select lives_ok(format($$select public.email_unlink_thread(%L)$$, pg_temp.u(701)), 'dono desvincula o vínculo automático');
select is((select count(*) from email_links where thread_id = pg_temp.u(501)), 0::bigint, 'vínculo desfeito some da lista do usuário');
select is((select count(*) from email_threads where id = pg_temp.u(501)), 1::bigint, 'dono ainda lê a conversa sem vínculo');
select pg_temp.as_user(pg_temp.u(12));
select is((select count(*) from email_threads where id = pg_temp.u(501)), 0::bigint, 'vínculo desfeito tira o acesso do gestor');

select pg_temp.as_user(pg_temp.u(11));
select is(public.email_link_thread(pg_temp.u(501), 'persons', pg_temp.u(311)), pg_temp.u(701), 'vincular de novo reativa o vínculo desfeito');
select pg_temp.as_pg();
select is((select unlinked_at is null and unlinked_by is null and origin = 'manual' from email_links where id = pg_temp.u(701)), true,
  'vínculo reativado fica manual e sem marca de desfeito');
select pg_temp.as_user(pg_temp.u(12));
select is((select count(*) from email_threads where id = pg_temp.u(501)), 1::bigint, 'vínculo reativado devolve o acesso do gestor');
select lives_ok(format($$select public.email_unlink_thread(%L)$$, pg_temp.u(701)), 'gestor com acesso ao card e à conversa desvincula');

-- Visibilidade da caixa --------------------------------------------------------
select pg_temp.as_user(pg_temp.u(12));
select is(pg_temp.affected($$update email_accounts set visibility = 'private'$$), 0::bigint, 'gestor não muda a visibilidade da caixa alheia');
select pg_temp.as_user(pg_temp.u(11));
select is(pg_temp.affected($$update email_accounts set visibility = 'private' where id = '00000000-0000-4000-8000-000000000401'$$), 1::bigint, 'dono muda a visibilidade da caixa');

-- Modelos ----------------------------------------------------------------------
select pg_temp.as_user(pg_temp.u(12));
select lives_ok(format($$insert into email_templates (company_id, name, subject, body) values (%L, 'tst-modelo', 'Olá {{pessoa.nome}}', 'Corpo')$$, pg_temp.u(1)),
  'gestor cria modelo da empresa');
select pg_temp.as_user(pg_temp.u(13));
select is((select count(*) from email_templates), 1::bigint, 'membro da empresa lê os modelos');
select throws_ok(format($$insert into email_templates (company_id, name, body) values (%L, 'tst-x', 'x')$$, pg_temp.u(1)),
  '42501', null, 'membro sem permissão de gerenciar não cria modelo');
select pg_temp.as_user(pg_temp.u(14));
select is((select count(*) from email_templates), 0::bigint, 'usuário de outra empresa não lê os modelos');

-- Apagar a caixa leva as conversas ---------------------------------------------
select pg_temp.as_user(pg_temp.u(12));
select is(pg_temp.affected($$delete from email_accounts where id = '00000000-0000-4000-8000-000000000402'$$), 0::bigint, 'gestor não apaga caixa alheia');
select pg_temp.as_user(pg_temp.u(11));
select is(pg_temp.affected($$delete from email_accounts where id = '00000000-0000-4000-8000-000000000402'$$), 1::bigint, 'dono apaga a própria caixa');
select pg_temp.as_pg();
select is((select count(*) from email_threads where id = pg_temp.u(502)) + (select count(*) from email_messages where id = pg_temp.u(602)), 0::bigint, 'apagar a caixa apaga conversas e mensagens');

select * from finish();
rollback;
