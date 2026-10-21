begin;
select plan(2);

select is(
  (select file_size_limit from storage.buckets where id = 'avatars'),
  2097152::bigint,
  'avatars limita o tamanho a 2 MB');
select is(
  (select allowed_mime_types from storage.buckets where id = 'avatars'),
  array['image/png','image/jpeg','image/webp'],
  'avatars aceita só png, jpeg e webp');

select * from finish();
rollback;
