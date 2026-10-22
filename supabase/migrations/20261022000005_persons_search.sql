-- Busca da lista de pessoas por nome, cargo, e-mail e telefone.
-- search_text = minúsculas, separado por espaço: nome, cargo, e-mails, telefones (só dígitos).
alter table public.persons add column search_text text not null default '';

create function public.persons_search_text(p_name text, p_job text, p_emails jsonb, p_phones jsonb)
returns text language sql immutable set search_path = public as $$
  select btrim(concat_ws(' ',
    lower(coalesce(p_name, '')),
    lower(coalesce(p_job, '')),
    (select string_agg(lower(e->>'value'), ' ') from jsonb_array_elements(case when jsonb_typeof(p_emails) = 'array' then p_emails else '[]'::jsonb end) e),
    (select string_agg(regexp_replace(e->>'value', '\D', '', 'g'), ' ') from jsonb_array_elements(case when jsonb_typeof(p_phones) = 'array' then p_phones else '[]'::jsonb end) e)
  ));
$$;

create function public.set_persons_search_text() returns trigger
language plpgsql set search_path = public as $$
begin
  new.search_text = public.persons_search_text(new.full_name, new.job_title, new.emails, new.phones);
  return new;
end $$;

-- Dispara depois de normalize_person_contacts (ordem alfabética dos nomes).
create trigger persons_search_text before insert or update on public.persons
  for each row execute function public.set_persons_search_text();

-- Preenche as linhas existentes sem acionar timeline nem outros gatilhos.
alter table public.persons disable trigger user;
update public.persons
  set search_text = public.persons_search_text(full_name, job_title, emails, phones);
alter table public.persons enable trigger user;

create index persons_search_trgm on public.persons using gin (search_text extensions.gin_trgm_ops);
