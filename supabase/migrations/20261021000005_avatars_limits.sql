-- O bucket valida tipo e tamanho no próprio Storage, não só na Server Action.
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/png','image/jpeg','image/webp']
where id = 'avatars';
