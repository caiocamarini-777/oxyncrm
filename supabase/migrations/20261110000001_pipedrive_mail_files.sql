-- Importação do Pipedrive: e-mails e arquivos que ficavam só lá (antes de desligar o Pipedrive).
-- Migration só aditiva. As tabelas são escritas pelo service role (script de importação).
--   pipedrive_emails       uma linha por mensagem e por empresa do CRM (o mesmo e-mail em duas
--                          empresas vira duas linhas, cada uma com os seus vínculos).
--   pipedrive_email_links  vínculos da mensagem com negócio, lead, pessoa ou organização.
--   record_files           arquivos do card (ligados ao registro) e anexos de e-mail (ligados ao
--                          e-mail). Sem storage_path é um link externo (remote_url).
-- A limpeza do modo espelho (import_mirror_prune) não mexe nestas tabelas: um vínculo com registro
-- na lixeira continua, e o e-mail some do card junto com o registro (can_read_record).

-- Tabelas ------------------------------------------------------------------

create table public.pipedrive_emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  -- Id da mensagem no Pipedrive (chave de idempotência junto com a empresa).
  pipedrive_id bigint not null,
  pipedrive_thread_id bigint,
  -- Vendedor dono da mensagem no Pipedrive (pelo mapa de usuários da importação; nulo se não mapeado).
  owner_id uuid references public.profiles on delete set null,
  subject text not null default '',
  from_email text not null default '',
  from_name text,
  "to" jsonb not null default '[]',
  cc jsonb not null default '[]',
  sent_at timestamptz not null,
  snippet text not null default '',
  -- Corpo cortado em 1 MB.
  body_html text check (body_html is null or char_length(body_html) <= 1048576),
  rfc_message_id text,
  direction text not null check (direction in ('in','out')),
  -- [{file_id, filename, size, mime}]
  attachments jsonb not null default '[]',
  imported_at timestamptz not null default now(),
  unique (company_id, pipedrive_id)
);
create index pipedrive_emails_thread_idx on public.pipedrive_emails (company_id, pipedrive_thread_id);
-- Para esconder o e-mail importado quando o do Gmail com o mesmo Message-ID já existe.
create index pipedrive_emails_rfc_message_idx on public.pipedrive_emails (rfc_message_id);

create table public.pipedrive_email_links (
  email_id uuid not null references public.pipedrive_emails on delete cascade,
  entity text not null check (entity in ('leads','deals','persons','organizations')),
  record_id uuid not null,
  primary key (email_id, entity, record_id)
);
create index pipedrive_email_links_record_idx on public.pipedrive_email_links (entity, record_id);

create table public.record_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies on delete cascade,
  -- Arquivo de card: registro ao qual pertence (nulo quando é anexo de e-mail).
  entity text check (entity in ('leads','deals','persons','organizations')),
  record_id uuid,
  -- Anexo de e-mail: a mensagem importada (nulo quando é arquivo do card).
  email_id uuid references public.pipedrive_emails on delete cascade,
  -- Id do arquivo no Pipedrive (chave de idempotência junto com a empresa).
  pipedrive_id bigint,
  filename text not null,
  mime text,
  size bigint,
  -- Caminho no bucket record-files: {company_id}/{id}/{filename}. Nulo quando é link externo
  -- ou quando o arquivo passou do limite do bucket (só o nome fica gravado).
  storage_path text,
  remote_url text,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((email_id is not null) or (entity is not null and record_id is not null)),
  unique (company_id, pipedrive_id)
);
create index record_files_record_idx on public.record_files (entity, record_id);

-- Permissões ----------------------------------------------------------------

-- O dono da mensagem e o admin geral leem sempre. Os demais, só se a caixa do dono no CRM não é
-- privada e algum registro vinculado é legível para o usuário.
create function public.can_read_pipedrive_email(p_email uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select public.current_user_active() and (
      e.owner_id = auth.uid()
      or public.is_super_admin()
      or (
        not exists (
          select 1 from public.email_accounts a
          where a.user_id = e.owner_id and a.company_id = e.company_id and a.visibility = 'private')
        and exists (
          select 1 from public.pipedrive_email_links l
          where l.email_id = e.id and public.can_read_record(l.entity, l.record_id))))
    from public.pipedrive_emails e
    where e.id = p_email), false);
$$;

-- Arquivo apagado não é lido. Anexo de e-mail segue o e-mail; arquivo de card segue o registro.
create function public.can_read_record_file(p_file uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select f.deleted_at is null and case
      when f.email_id is not null then public.can_read_pipedrive_email(f.email_id)
      else public.can_read_record(f.entity, f.record_id)
    end
    from public.record_files f
    where f.id = p_file), false);
$$;

revoke execute on function public.can_read_pipedrive_email(uuid), public.can_read_record_file(uuid)
  from public, anon;
grant execute on function public.can_read_pipedrive_email(uuid), public.can_read_record_file(uuid)
  to authenticated;

-- RLS e grants --------------------------------------------------------------

alter table public.pipedrive_emails enable row level security;
alter table public.pipedrive_email_links enable row level security;
alter table public.record_files enable row level security;

revoke all on public.pipedrive_emails, public.pipedrive_email_links, public.record_files from anon;
revoke all on public.pipedrive_emails, public.pipedrive_email_links, public.record_files from authenticated;

-- authenticated: só leitura (filtrada por RLS). A escrita é do service role (script de importação).
grant select on public.pipedrive_emails, public.pipedrive_email_links, public.record_files to authenticated;
grant select, insert, update, delete on public.pipedrive_emails, public.pipedrive_email_links,
  public.record_files to service_role;

create policy pipedrive_emails_select on public.pipedrive_emails for select to authenticated
  using (public.can_read_pipedrive_email(id));
create policy pipedrive_email_links_select on public.pipedrive_email_links for select to authenticated
  using (public.can_read_pipedrive_email(email_id));
create policy record_files_select on public.record_files for select to authenticated
  using (public.can_read_record_file(id));

-- Storage: bucket privado dos arquivos importados ---------------------------

-- Sem policy em storage.objects para authenticated: só o service role lê e grava,
-- e o download é por URL assinada (a server action confere o acesso antes).
insert into storage.buckets (id, name, public, file_size_limit)
values ('record-files', 'record-files', false, 26214400)
on conflict (id) do nothing;
