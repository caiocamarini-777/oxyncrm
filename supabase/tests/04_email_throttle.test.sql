begin;
select plan(4);

select is(
  (select array_agg(public.consume_email_quota('tst-throttle:a', 3, interval '15 minutes')) from generate_series(1,4)),
  array[true,true,true,false],
  '3 chamadas passam e a 4a é bloqueada');

select ok(public.consume_email_quota('tst-throttle:b', 3, interval '15 minutes'), 'outra chave é independente');

set local role authenticated;
select throws_ok(
  $$select public.consume_email_quota('tst-throttle:c', 3, interval '15 minutes')$$,
  '42501');
reset role;

select is(
  (select count(*)::int from public.email_send_log where key = 'tst-throttle:c'), 0,
  'chamada negada não grava');

select * from finish();
rollback;
