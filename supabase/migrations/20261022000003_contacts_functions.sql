-- Duplicidade, linha do tempo, busca global e lixeira (fase 2, tarefa 3).

create extension if not exists pg_cron;

-- Duplicidade -------------------------------------------------------------

create function public.check_duplicates(
  p_company uuid, p_entity text,
  p_emails text[] default '{}', p_phones text[] default '{}',
  p_cnpj text default null, p_domain text default null, p_exclude uuid default null)
returns table(matched_on text, owner_name text, record_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_emails text[];
  v_phones text[];
  cnpj_n text;
  domain_n text;
begin
  if p_entity not in ('persons', 'organizations') then
    raise exception 'OXYN_INVALID_ENTITY';
  end if;
  if not public.has_company_access(p_company) then
    return;
  end if;

  if p_entity = 'persons' then
    select coalesce(array_agg(distinct lower(regexp_replace(x, '\s', '', 'g'))) filter (where x is not null and btrim(x) <> ''), '{}')
      into v_emails from unnest(coalesce(p_emails, '{}')) x;
    select coalesce(array_agg(distinct regexp_replace(regexp_replace(x, '\D', '', 'g'), '^55(?=\d{10,11}$)', '')) filter (where regexp_replace(coalesce(x, ''), '\D', '', 'g') <> ''), '{}')
      into v_phones from unnest(coalesce(p_phones, '{}')) x;
    return query
      select distinct m.kind, pr.full_name, case when public.can_access(p.company_id, 'persons', p.owner_id, 'read') then p.id end
      from public.persons p
      join public.profiles pr on pr.id = p.owner_id
      cross join lateral (
        select 'email'::text as kind from jsonb_array_elements(p.emails) e where e->>'value' = any (v_emails)
        union all
        select 'phone'::text from jsonb_array_elements(p.phones) e where e->>'value' = any (v_phones)
      ) m
      where p.company_id = p_company and p.deleted_at is null
        and (p_exclude is null or p.id <> p_exclude);
  else
    cnpj_n := nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '');
    domain_n := nullif(lower(btrim(coalesce(p_domain, ''))), '');
    return query
      select m.kind, pr.full_name, case when public.can_access(o.company_id, 'organizations', o.owner_id, 'read') then o.id end
      from public.organizations o
      join public.profiles pr on pr.id = o.owner_id
      cross join lateral (
        select 'cnpj'::text as kind where cnpj_n is not null and o.cnpj = cnpj_n
        union all
        select 'domain'::text where domain_n is not null and o.domain = domain_n
      ) m
      where o.company_id = p_company and o.deleted_at is null
        and (p_exclude is null or o.id <> p_exclude);
  end if;
end $$;
revoke execute on function public.check_duplicates(uuid, text, text[], text[], text, text, uuid) from public, anon;
grant execute on function public.check_duplicates(uuid, text, text[], text[], text, text, uuid) to authenticated;

-- Linha do tempo ----------------------------------------------------------

create function public.timeline_record_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ent text := tg_table_name;
  n jsonb := to_jsonb(new);
  o jsonb;
  changed text[];
  skip text[] := array['updated_at', 'deleted_at', 'owner_id', 'search_text'];
begin
  if tg_op = 'INSERT' then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id)
    values (new.company_id, ent, new.id, 'created', auth.uid());
    return new;
  end if;

  o := to_jsonb(old);
  if new.owner_id is distinct from old.owner_id then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
    values (new.company_id, ent, new.id, 'owner_changed', auth.uid(),
      jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  if ent = 'leads' and n->>'status' is distinct from o->>'status' then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
    values (new.company_id, ent, new.id, 'status_changed', auth.uid(),
      jsonb_build_object('from', o->>'status', 'to', n->>'status', 'reason_id', n->'disqualification_reason_id'));
    skip := skip || array['status', 'disqualification_reason_id'];
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id)
    values (new.company_id, ent, new.id, case when new.deleted_at is null then 'restored' else 'trashed' end, auth.uid());
  end if;

  select array_agg(k order by k) into changed
  from jsonb_object_keys(n) k
  where n->k is distinct from o->k and not (k = any (skip));
  if changed is not null then
    insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
    values (new.company_id, ent, new.id, 'updated', auth.uid(), jsonb_build_object('fields', to_jsonb(changed)));
  end if;
  return new;
end $$;

create trigger organizations_timeline after insert or update on public.organizations
  for each row execute function public.timeline_record_changes();
create trigger persons_timeline after insert or update on public.persons
  for each row execute function public.timeline_record_changes();
create trigger leads_timeline after insert or update on public.leads
  for each row execute function public.timeline_record_changes();

create function public.timeline_note_added() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
  values (new.company_id, new.entity, new.record_id, 'note_added', auth.uid(), jsonb_build_object('note_id', new.id));
  return new;
end $$;
create trigger notes_timeline after insert on public.notes
  for each row execute function public.timeline_note_added();

create function public.timeline_label_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.record_labels := case when tg_op = 'DELETE' then old else new end;
  l record;
begin
  select company_id, name into l from public.labels where id = r.label_id;
  if l.company_id is null then
    return r; -- etiqueta removida em cascata
  end if;
  insert into public.timeline_events (company_id, entity, record_id, kind, actor_id, data)
  values (l.company_id, r.entity, r.record_id,
    case when tg_op = 'DELETE' then 'label_removed' else 'label_added' end, auth.uid(),
    jsonb_build_object('label_id', r.label_id, 'name', l.name));
  return r;
end $$;
create trigger record_labels_timeline after insert or delete on public.record_labels
  for each row execute function public.timeline_label_changed();

revoke execute on function public.timeline_record_changes(), public.timeline_note_added(), public.timeline_label_changed()
  from public, anon, authenticated;

-- Busca global (security invoker: o RLS filtra) -----------------------------

create function public.global_search(p_query text, p_company uuid default null, p_limit int default 5)
returns table(entity text, record_id uuid, company_id uuid, title text, subtitle text)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  pat text;
begin
  if p_query is null or char_length(btrim(p_query)) < 2 then
    return;
  end if;
  pat := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  p_limit := least(greatest(coalesce(p_limit, 5), 1), 20);

  return query
    (select 'organizations'::text, o.id, o.company_id, o.name, coalesce(o.domain, o.cnpj)
     from public.organizations o
     where o.deleted_at is null and (p_company is null or o.company_id = p_company)
       and (lower(o.name) like lower(pat) escape '\' or o.cnpj ilike pat escape '\' or o.domain ilike pat escape '\')
     order by o.name limit p_limit)
    union all
    (select 'persons'::text, p.id, p.company_id, p.full_name, p.emails->0->>'value'
     from public.persons p
     where p.deleted_at is null and (p_company is null or p.company_id = p_company)
       and (lower(p.full_name) like lower(pat) escape '\'
         or exists (select 1 from jsonb_array_elements(p.emails) e where e->>'value' ilike pat escape '\'))
     order by p.full_name limit p_limit)
    union all
    (select 'leads'::text, l.id, l.company_id, l.title, l.status
     from public.leads l
     where l.deleted_at is null and (p_company is null or l.company_id = p_company)
       and lower(l.title) like lower(pat) escape '\'
     order by l.title limit p_limit);
end $$;
revoke execute on function public.global_search(text, uuid, int) from public, anon;
grant execute on function public.global_search(text, uuid, int) to authenticated;

-- Lixeira -------------------------------------------------------------------

create function public.purge_trash() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cutoff timestamptz := now() - interval '30 days';
  total int := 0;
  n int;
  ent text;
  ids uuid[];
begin
  foreach ent in array array['leads', 'persons', 'organizations'] loop
    execute format('select coalesce(array_agg(id), ''{}'') from public.%I where deleted_at < $1', ent) into ids using cutoff;
    if cardinality(ids) = 0 then continue; end if;
    delete from public.record_labels where entity = ent and record_id = any (ids);
    delete from public.notes where entity = ent and record_id = any (ids);
    execute format('delete from public.%I where id = any ($1)', ent) using ids;
    get diagnostics n = row_count;
    total := total + n;
    delete from public.timeline_events where entity = ent and record_id = any (ids);
  end loop;
  delete from public.notes where deleted_at < cutoff;
  get diagnostics n = row_count;
  return total + n;
end $$;
revoke execute on function public.purge_trash() from public, anon, authenticated, service_role;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'oxyn-purge-trash';
  perform cron.schedule('oxyn-purge-trash', '0 6 * * *', 'select public.purge_trash()');
end $$;
