-- Fase 5 (Gmail): caixas conectadas, conversas, mensagens, vínculos e modelos de e-mail.
-- Migration só aditiva. As tabelas de conteúdo são escritas pelo service role (cron e callback OAuth).

-- Tabelas ------------------------------------------------------------------

create table public.email_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  email text not null unique check (email = lower(email) and char_length(email) between 3 and 320),
  status text not null default 'active' check (status in ('active','reconnect')),
  visibility text not null default 'shared' check (visibility in ('shared','private')),
  history_id text,
  backfill_page_token text,
  backfill_done boolean not null default false,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index email_accounts_user_idx on public.email_accounts (user_id);
create index email_accounts_company_idx on public.email_accounts (company_id);
create index email_accounts_sync_idx on public.email_accounts (last_synced_at nulls first) where status = 'active';

-- Tokens criptografados na aplicação (AES-256-GCM). RLS ligado e sem policy: só o service role.
create table public.email_account_secrets (
  account_id uuid primary key references public.email_accounts on delete cascade,
  refresh_token_enc text not null,
  access_token_enc text,
  access_expires_at timestamptz
);

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.email_accounts on delete cascade,
  company_id uuid not null references public.companies on delete cascade,
  gmail_thread_id text not null,
  subject text not null default '',
  last_message_at timestamptz,
  unique (account_id, gmail_thread_id)
);
create index email_threads_account_last_idx on public.email_threads (account_id, last_message_at);

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads on delete cascade,
  account_id uuid not null references public.email_accounts on delete cascade,
  gmail_message_id text not null,
  rfc_message_id text,
  from_email text not null default '',
  from_name text,
  "to" jsonb not null default '[]',
  cc jsonb not null default '[]',
  sent_at timestamptz not null,
  snippet text not null default '',
  body_html text,
  body_text text,
  attachments jsonb not null default '[]',
  direction text not null check (direction in ('in','out')),
  unique (account_id, gmail_message_id)
);
create index email_messages_thread_sent_idx on public.email_messages (thread_id, sent_at);

create table public.email_links (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads on delete cascade,
  entity text not null check (entity in ('leads','deals','persons','organizations')),
  record_id uuid not null,
  origin text not null check (origin in ('auto','manual')),
  linked_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  unlinked_at timestamptz,
  unlinked_by uuid references public.profiles on delete set null,
  unique (thread_id, entity, record_id)
);
create index email_links_record_idx on public.email_links (entity, record_id);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  subject text not null default '' check (char_length(subject) <= 300),
  body text not null default '' check (char_length(body) <= 20000),
  created_by uuid not null default auth.uid() references public.profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index email_templates_company_idx on public.email_templates (company_id);

create trigger set_updated_at before update on public.email_templates
  for each row execute function public.set_updated_at();
create trigger guard_company_immutable before update on public.email_templates
  for each row execute function public.guard_company_immutable();

-- Permissões ----------------------------------------------------------------

-- Dono da caixa, ou caixa compartilhada com vínculo ativo para um registro que o usuário lê.
create function public.can_read_email_thread(p_thread uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select public.current_user_active() and (
      a.user_id = auth.uid()
      or (a.visibility = 'shared' and exists (
        select 1 from public.email_links l
        where l.thread_id = t.id and l.unlinked_at is null
          and public.can_read_record(l.entity, l.record_id))))
    from public.email_threads t
    join public.email_accounts a on a.id = t.account_id
    where t.id = p_thread), false);
$$;

-- Vincula (ou reativa um vínculo desfeito). Só o dono da caixa, em registro editável da mesma empresa.
create function public.email_link_thread(p_thread uuid, p_entity text, p_record uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_account public.email_accounts;
  v_company uuid;
  v_id uuid;
begin
  if auth.uid() is null or not public.current_user_active() then
    raise exception 'OXYN_EMAIL_FORBIDDEN' using errcode = '42501';
  end if;
  if p_entity not in ('leads','deals','persons','organizations') then
    raise exception 'OXYN_INVALID_ENTITY';
  end if;
  select a.* into v_account
    from public.email_threads t join public.email_accounts a on a.id = t.account_id
    where t.id = p_thread;
  if not found or v_account.user_id <> auth.uid() then
    raise exception 'OXYN_EMAIL_FORBIDDEN' using errcode = '42501';
  end if;
  select r.company_id into v_company from public.record_ref(p_entity, p_record) r;
  if v_company is distinct from v_account.company_id or not public.can_edit_record(p_entity, p_record) then
    raise exception 'OXYN_EMAIL_FORBIDDEN' using errcode = '42501';
  end if;
  insert into public.email_links (thread_id, entity, record_id, origin, linked_by)
    values (p_thread, p_entity, p_record, 'manual', auth.uid())
  on conflict (thread_id, entity, record_id) do update
    set unlinked_at = null, unlinked_by = null,
        origin = case when public.email_links.unlinked_at is null then public.email_links.origin else 'manual' end,
        linked_by = case when public.email_links.unlinked_at is null then public.email_links.linked_by else auth.uid() end
  returning id into v_id;
  return v_id;
end $$;

-- Desfaz o vínculo (fica registrado com unlinked_at, para o automático não recriar).
create function public.email_unlink_thread(p_link uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.email_links;
  v_owner uuid;
begin
  if auth.uid() is null or not public.current_user_active() then
    raise exception 'OXYN_EMAIL_FORBIDDEN' using errcode = '42501';
  end if;
  select * into l from public.email_links where id = p_link;
  if not found then
    raise exception 'OXYN_EMAIL_FORBIDDEN' using errcode = '42501';
  end if;
  select a.user_id into v_owner
    from public.email_threads t join public.email_accounts a on a.id = t.account_id
    where t.id = l.thread_id;
  if not (v_owner = auth.uid()
          or (public.can_read_email_thread(l.thread_id) and public.can_edit_record(l.entity, l.record_id))) then
    raise exception 'OXYN_EMAIL_FORBIDDEN' using errcode = '42501';
  end if;
  update public.email_links set unlinked_at = now(), unlinked_by = auth.uid()
    where id = p_link and unlinked_at is null;
end $$;

revoke execute on function public.can_read_email_thread(uuid), public.email_link_thread(uuid, text, uuid),
  public.email_unlink_thread(uuid) from public, anon;
grant execute on function public.can_read_email_thread(uuid), public.email_link_thread(uuid, text, uuid),
  public.email_unlink_thread(uuid) to authenticated;
-- O cron (service role) grava com acesso direto às tabelas, sem passar por estas funções.

-- RLS e grants --------------------------------------------------------------

alter table public.email_accounts enable row level security;
alter table public.email_account_secrets enable row level security;
alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_links enable row level security;
alter table public.email_templates enable row level security;

revoke all on public.email_accounts, public.email_account_secrets, public.email_threads,
  public.email_messages, public.email_links, public.email_templates from anon;
revoke all on public.email_accounts, public.email_account_secrets, public.email_threads,
  public.email_messages, public.email_links, public.email_templates from authenticated;

-- authenticated: leitura (filtrada por RLS); só a visibilidade da caixa e os modelos são editáveis direto.
grant select on public.email_accounts, public.email_threads, public.email_messages,
  public.email_links, public.email_templates to authenticated;
grant update (visibility) on public.email_accounts to authenticated;
grant delete on public.email_accounts to authenticated;
grant insert, update, delete on public.email_templates to authenticated;

-- service_role: escreve tudo (callback OAuth e cron).
grant select, insert, update, delete on public.email_accounts, public.email_account_secrets,
  public.email_threads, public.email_messages, public.email_links, public.email_templates to service_role;

create policy email_accounts_select on public.email_accounts for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());
create policy email_accounts_update on public.email_accounts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy email_accounts_delete on public.email_accounts for delete to authenticated
  using (user_id = auth.uid());

create policy email_threads_select on public.email_threads for select to authenticated
  using (public.can_read_email_thread(id));
create policy email_messages_select on public.email_messages for select to authenticated
  using (public.can_read_email_thread(thread_id));
create policy email_links_select on public.email_links for select to authenticated
  using (unlinked_at is null
    and public.can_read_email_thread(thread_id)
    and public.can_read_record(entity, record_id));

create policy email_templates_select on public.email_templates for select to authenticated
  using (public.has_company_access(company_id));
create policy email_templates_insert on public.email_templates for insert to authenticated
  with check (public.can_manage_company_lists(company_id) and created_by = auth.uid());
create policy email_templates_update on public.email_templates for update to authenticated
  using (public.can_manage_company_lists(company_id))
  with check (public.can_manage_company_lists(company_id));
create policy email_templates_delete on public.email_templates for delete to authenticated
  using (public.can_manage_company_lists(company_id));
