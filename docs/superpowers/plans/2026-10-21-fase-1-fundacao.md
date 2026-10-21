# Fase 1: Fundação, plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o Oxyn CRM com login, empresas, usuários, papéis configuráveis, equipes, permissões aplicadas no banco e o layout base no padrão Pipedrive com a marca Oxyn.

**Architecture:** Next.js (App Router, TypeScript) conversa direto com o Supabase usando a sessão do usuário, de modo que o Row Level Security decide o que cada um vê. Toda regra de proteção vive em migrações SQL testadas com pgTAP. O cliente com service role é usado só no servidor e só para a API de administração do Auth (convidar, banir).

**Tech Stack:** Next.js ≥ 15 (App Router), TypeScript strict, pnpm, Node ≥ 22, Supabase (Postgres, Auth, Storage) com `@supabase/ssr` e `@supabase/supabase-js`, Tailwind CSS v4, shadcn/ui, next-themes, zod, react-hook-form, lucide-react, Vitest, Playwright, pgTAP (`supabase test db`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-oxyn-crm-design.md` (seções 2, 3, 4.1, 5 e 6, fase 1)

## Global Constraints

- Toda regra que protege dado é aplicada no banco (RLS, triggers, constraints). A interface repete validações, nunca é a única barreira.
- Cores: teal `#1A82A2` (primário), `#6498A8`, `#75ACBA`; fundos escuros `#111D17` (barra lateral), `#06090F`, `#0C0C0C`. Proibido âmbar, dourado e laranja; alertas usam vermelho e cinza neutros.
- Fontes: Montserrat (títulos, números de destaque, rótulos de seção em caixa alta), Inter (corpo, tabelas, formulários), via `next/font/google`.
- Textos da interface em português do Brasil, diretos, sem emoji e sem travessão (—).
- Não existe cadastro aberto: só convite feito pelo admin geral. Login por e-mail e senha ou Google.
- Só o admin geral (`profiles.is_super_admin`) cria empresas, papéis, equipes e convida usuários.
- Papel padrão do sistema: "Usuário padrão", com `own` em todas as entidades.
- O slug `todas` é reservado para a visão "Todas as empresas".
- Chave service role nunca vai para o browser: só em arquivos `server-only`.
- Identificadores de código em inglês; rotas e textos visíveis em português.

## Ajustes em relação à spec

- **Sem tabela `invitations`.** O convite usa `auth.admin.inviteUserByEmail`, que cria o usuário em `auth.users` na hora. O trigger cria o `profile`, e o servidor grava `memberships` e `team_members` em seguida. O estado "convite pendente" é lido de `auth.users.email_confirmed_at` (nulo enquanto o usuário não aceitou). Mesmo resultado com uma tabela a menos.
- **Auditoria só grava nesta fase.** A tela de consulta chega com a linha do tempo da fase 2.

## Review Focus

1. Usuário sem nenhum acesso a empresa faz login: deve ver a tela "Você ainda não tem acesso a nenhuma empresa", não um erro. Teste na Task 6.
2. URL com slug de empresa à qual o usuário não pertence (ou arquivada, ou inexistente): deve dar 404 idêntico nos três casos, sem revelar que a empresa existe. Teste na Task 6.
3. Usuário desativado com sessão aberta: a próxima requisição o desloga e o RLS já não devolve nada. Testes nas Tasks 3 e 10.
4. Admin geral tenta se desativar ou tirar o próprio admin, ou remover o último admin geral ativo: deve ser bloqueado com mensagem clara. Testes nas Tasks 4 e 10.
5. Excluir papel em uso, ou o papel do sistema: bloqueado com mensagem que diz o motivo. Testes nas Tasks 4 e 8.

---

## Estrutura de arquivos

```
.github/workflows/ci.yml
supabase/
  config.toml
  migrations/
    20261021000001_access_schema.sql        # tabelas, triggers utilitários, papel padrão
    20261021000002_permission_functions.sql # is_super_admin, can_access etc.
    20261021000003_access_rls.sql           # políticas, guardas, auditoria, bucket avatars
  templates/invite.html, recovery.html      # e-mails em PT-BR com token_hash
  tests/
    01_access_schema.test.sql
    02_permission_functions.test.sql
    03_access_rls.test.sql
  seed.sql                                  # admin local + dados de exemplo
src/
  app/
    layout.tsx, globals.css                 # fontes, tema, tokens
    page.tsx                                # redireciona para a empresa padrão
    (auth)/entrar/page.tsx
    (auth)/recuperar-senha/page.tsx
    (auth)/definir-senha/page.tsx
    auth/confirm/route.ts                   # troca token_hash por sessão
    auth/callback/route.ts                  # retorno do Google OAuth
    sem-acesso/page.tsx
    (app)/layout.tsx                        # shell: sidebar + topbar
    (app)/[empresa]/layout.tsx              # resolve escopo da empresa
    (app)/[empresa]/inicio/page.tsx
    (app)/perfil/page.tsx
    (app)/configuracoes/layout.tsx          # exige admin geral
    (app)/configuracoes/empresas/page.tsx
    (app)/configuracoes/papeis/page.tsx
    (app)/configuracoes/papeis/[id]/page.tsx
    (app)/configuracoes/equipes/page.tsx
    (app)/configuracoes/usuarios/page.tsx
  middleware.ts                             # ou proxy.ts, conforme a versão do Next
  lib/
    supabase/server.ts, client.ts, admin.ts, middleware.ts
    auth/session.ts                         # getCurrentProfile, requireUser, requireSuperAdmin
    db-errors.ts                            # traduz erros do Postgres para PT-BR
    companies/scope.ts, slug.ts, cnpj.ts, schema.ts, actions.ts
    permissions/schema.ts, labels.ts
    roles/actions.ts
    teams/actions.ts
    users/actions.ts, schema.ts
    nav.ts
  components/
    shell/sidebar.tsx, topbar.tsx, company-switcher.tsx, command-palette.tsx,
          quick-create.tsx, theme-toggle.tsx, user-menu.tsx
    settings/…                              # formulários de cada tela de configuração
    ui/…                                    # gerados pelo shadcn
scripts/bootstrap-admin.ts
e2e/
  helpers/mailpit.ts, auth.ts
  auth.spec.ts, shell.spec.ts, companies.spec.ts, roles.spec.ts,
  teams.spec.ts, users.spec.ts, profile.spec.ts
README.md
```

Os testes Vitest ficam ao lado do código (`*.test.ts`).

---

### Task 1: Esqueleto do projeto e CI

**Files:**
- Create: projeto Next.js na raiz, `supabase/config.toml`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `.github/workflows/ci.yml`, `src/lib/smoke.test.ts`

**Interfaces:**
- Produces: scripts `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest), `pnpm test:db` (`supabase test db`), `pnpm test:e2e` (Playwright); variáveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`.

- [ ] **Step 1: Gerar o app**

Run: `pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm` e depois `pnpm dlx shadcn@latest init` (base color neutral, CSS variables).
Expected: `pnpm dev` sobe em `http://localhost:3000`.

- [ ] **Step 2: Instalar dependências**

`pnpm add @supabase/ssr @supabase/supabase-js zod react-hook-form @hookform/resolvers next-themes lucide-react server-only` e `pnpm add -D vitest @vitejs/plugin-react vite-tsconfig-paths @playwright/test supabase tsx`. Adicionar `"typecheck": "tsc --noEmit"` e os scripts de teste acima ao `package.json`.

- [ ] **Step 3: Iniciar o Supabase local**

Run: `pnpm supabase init` e ajustar `supabase/config.toml`:
- `[auth] site_url = "http://localhost:3000"`, `additional_redirect_urls = ["http://localhost:3000/auth/confirm", "http://localhost:3000/auth/callback"]`, `enable_signup = false`
- `[auth.email] enable_signup = false`, `enable_confirmations = false`
- `[auth.external.google] enabled = true`, `client_id = "env(GOOGLE_CLIENT_ID)"`, `secret = "env(GOOGLE_CLIENT_SECRET)"`, `skip_nonce_check = false`

Run: `pnpm supabase start`
Expected: imprime API URL `http://127.0.0.1:54321`, Studio `:54323` e Mailpit `:54324`. Copiar as chaves para `.env.local` e listar as variáveis (sem valores reais) em `.env.example`.

- [ ] **Step 4: Teste de fumaça do Vitest**

`src/lib/smoke.test.ts`: `expect(1 + 1).toBe(2)`. `vitest.config.ts` com `vite-tsconfig-paths`, ambiente `node` e `include: ["src/**/*.test.ts"]`.
Run: `pnpm test`
Expected: 1 teste passando.

- [ ] **Step 5: Playwright**

`playwright.config.ts`: `testDir: "e2e"`, `baseURL: "http://localhost:3000"`, `webServer: { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true }`, projeto chromium apenas, `workers: 1` (os testes compartilham o banco local).

- [ ] **Step 6: CI**

`.github/workflows/ci.yml`, disparado em push e pull request: checkout → pnpm + Node 22 → `pnpm install --frozen-lockfile` → `supabase/setup-cli@v1` → `supabase start` → exporta as chaves de `supabase status -o env` para `$GITHUB_ENV` → `pnpm lint` → `pnpm typecheck` → `pnpm test` → `pnpm test:db` → `pnpm build` → `pnpm exec playwright install --with-deps chromium` → `pnpm test:e2e`.

- [ ] **Step 7: Verificar e commitar**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo passa.

```bash
git add -A
git commit -m "chore: esqueleto Next.js + Supabase + testes + CI"
```

---

### Task 2: Schema de acesso

**Files:**
- Create: `supabase/migrations/20261021000001_access_schema.sql`
- Test: `supabase/tests/01_access_schema.test.sql`

**Interfaces:**
- Produces (tabelas em `public`):
  - `companies(id uuid pk, name text not null, slug text unique not null, legal_name text, cnpj text, logo_url text, currency char(3) not null default 'BRL', settings jsonb not null default '{}', archived_at timestamptz, created_at, updated_at)`
  - `profiles(id uuid pk → auth.users on delete cascade, full_name text not null default '', email text unique not null, avatar_url text, is_super_admin bool not null default false, active bool not null default true, created_at, updated_at)`
  - `roles(id uuid pk, name text unique not null, description text, permissions jsonb not null, is_system bool not null default false, created_at, updated_at)`
  - `teams(id uuid pk, name text unique not null, created_at, updated_at)`
  - `team_members(team_id → teams on delete cascade, user_id → profiles on delete cascade, pk(team_id, user_id))`
  - `memberships(id uuid pk, user_id → profiles on delete cascade, company_id → companies on delete cascade, role_id → roles on delete restrict, unique(user_id, company_id), created_at)`
  - `audit_log(id bigint identity pk, table_name text not null, record_id uuid, action text check in ('insert','update','delete'), actor_id uuid, old_data jsonb, new_data jsonb, created_at timestamptz not null default now())`, índice em `(table_name, record_id)`
  - Funções: `set_updated_at()` (trigger), `handle_new_user()` (trigger em `auth.users` after insert, cria o profile com `email` e `raw_user_meta_data->>'full_name'`), `is_valid_permissions(p jsonb) returns boolean immutable`
  - Linha em `roles`: `name = 'Usuário padrão'`, `is_system = true`, permissões abaixo

**Regras fixas:**
- `companies.slug`: check `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug <> 'todas'`.
- `companies.cnpj`: check `cnpj is null or cnpj ~ '^\d{14}$'` (só dígitos; a máscara é da interface).
- `roles.permissions`: check `is_valid_permissions(permissions)`. A função exige exatamente:
  - `visibility` com as chaves `leads`, `deals`, `persons`, `organizations`, `activities`, cada uma `own`, `team` ou `company`;
  - `actions` com `create`, `edit`, `delete`, `export`, `reassign_owner` booleanos;
  - `settings` com `manage_pipelines`, `manage_custom_fields`, `manage_products`, `view_reports`, `create_dashboards`, `share_dashboards` booleanos.
  - Chave faltando, sobrando ou com valor de outro tipo → `false`.
- Permissões do "Usuário padrão": visibilidade `own` em todas; `create` e `edit` true, demais ações false; `view_reports` e `create_dashboards` true, demais configurações false.
- `set_updated_at` ligado a `companies`, `profiles`, `roles`, `teams`.

- [ ] **Step 1: Escrever o teste pgTAP que falha**

`01_access_schema.test.sql`, dentro de `begin; select plan(N); … select * from finish(); rollback;`:
- `has_table` para as sete tabelas.
- `throws_ok` ao inserir company com slug `'todas'`, com slug `'Volt SA'` e com cnpj `'11.222.333/0001-81'` (código `23514`).
- `lives_ok` ao inserir company `('Volt', 'volt', cnpj '11222333000181')`.
- `ok(is_valid_permissions(<json do usuário padrão>))`; `ok(not is_valid_permissions(…))` para: visibilidade `'all'`, falta `share_dashboards`, chave extra `actions.foo`, `create` como string `'true'`.
- Inserir um usuário em `auth.users` (id e e-mail fixos, `raw_user_meta_data = '{"full_name":"Ana Teste"}'`) e `results_eq` em `select full_name, is_super_admin, active from profiles where id = …` → `('Ana Teste', false, true)`.
- `is((select count(*) from roles where is_system), 1::bigint)`.
- `throws_ok` ao inserir duas memberships para o mesmo usuário e empresa (`23505`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm supabase db reset && pnpm test:db`
Expected: FAIL (tabelas inexistentes).

- [ ] **Step 3: Escrever a migração**

Implementar as tabelas, constraints, triggers e a linha do papel padrão conforme as Interfaces e Regras fixas.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm supabase db reset && pnpm test:db`
Expected: PASS em `01_access_schema.test.sql`.

- [ ] **Step 5: Commitar**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat(db): schema de acesso multiempresa"
```

---

### Task 3: Funções de permissão

**Files:**
- Create: `supabase/migrations/20261021000002_permission_functions.sql`
- Test: `supabase/tests/02_permission_functions.test.sql`

**Interfaces:**
- Consumes: tabelas da Task 2.
- Produces (todas `stable security definer set search_path = public`, `grant execute to authenticated`):
  - `current_user_active() returns boolean`: profile de `auth.uid()` existe e `active`.
  - `is_super_admin() returns boolean`: ativo e `is_super_admin`.
  - `has_company_access(p_company uuid) returns boolean`: admin geral ativo; ou usuário ativo com membership na empresa e `companies.archived_at is null`.
  - `role_permissions(p_company uuid) returns jsonb`: `permissions` do papel do usuário naquela empresa, ou `null` sem membership ou com empresa arquivada.
  - `shares_team(p_other uuid) returns boolean`: `auth.uid()` e `p_other` estão em pelo menos uma equipe em comum.
  - `can_access(p_company uuid, p_entity text, p_owner uuid, p_action text) returns boolean`. `p_entity` ∈ chaves de `visibility`; `p_action` ∈ `read`, `create`, `edit`, `delete`, `export`, `reassign_owner`. Ação fora da lista → `raise exception 'OXYN_UNKNOWN_ACTION'`.

Esta função é a base de todas as políticas RLS das fases 2 a 6. Algoritmo:

```sql
declare me uuid := auth.uid(); perms jsonb; vis text;
begin
  if p_action not in ('read','create','edit','delete','export','reassign_owner') then
    raise exception 'OXYN_UNKNOWN_ACTION';
  end if;
  if me is null or not current_user_active() then return false; end if;
  if is_super_admin() then return true; end if;
  perms := role_permissions(p_company);
  if perms is null then return false; end if;
  if p_action <> 'read' and not coalesce((perms->'actions'->>p_action)::boolean, false) then
    return false;
  end if;
  if p_action = 'create' then return true; end if;
  vis := perms->'visibility'->>p_entity;
  return case vis
    when 'company' then true
    when 'team' then p_owner = me or shares_team(p_owner)
    when 'own' then p_owner = me
    else false
  end;
end;
```

- [ ] **Step 1: Escrever o teste pgTAP que falha**

Fixture no início do arquivo: empresas `volt` e `naia`; usuários `admin` (super admin), `ana`, `bruno`, `caio`, `inativo`; papéis `Equipe` (visibilidade `team` em tudo, `delete` false) e `Empresa` (visibilidade `company` em tudo, `delete` true); equipe `SDR` com `ana` e `bruno`; memberships: `ana`→volt `Equipe`, `bruno`→volt `Usuário padrão`, `caio`→volt `Empresa`, `inativo`→volt `Empresa` com `active = false`. Helper para assumir um usuário: `set local role authenticated; select set_config('request.jwt.claims', json_build_object('sub', <id>, 'role', 'authenticated')::text, true);`.

Casos (`ok`/`is`), cada um com descrição:
- `bruno` lê deal próprio em volt → true; lê deal de `ana` → false (`own`).
- `ana` lê deal de `bruno` → true (mesma equipe); lê deal de `caio` → false.
- `caio` lê deal de `ana` → true (`company`); `caio` delete deal de `ana` → true.
- `ana` delete deal próprio → false (ação desligada).
- `bruno` create em volt → true; `bruno` create em naia → false (sem membership).
- `caio` lê qualquer coisa em naia → false.
- `admin` lê, edita e exclui em naia → true.
- `inativo` lê em volt → false.
- Empresa volt arquivada: `caio` lê → false; `admin` lê → true.
- Sem `request.jwt.claims` (anônimo) → false.
- `throws_ok` com ação `'destroy'` → `'OXYN_UNKNOWN_ACTION'`.
- `can_access(volt, 'invoices', <dono>, 'read')` com `bruno` → false (entidade desconhecida cai no `else`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm supabase db reset && pnpm test:db`
Expected: FAIL em `02_permission_functions.test.sql`.

- [ ] **Step 3: Implementar as funções**

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm supabase db reset && pnpm test:db`
Expected: PASS nos arquivos 01 e 02.

- [ ] **Step 5: Commitar**

```bash
git add supabase
git commit -m "feat(db): funções de permissão e can_access"
```

---

### Task 4: RLS, guardas e auditoria das tabelas de acesso

**Files:**
- Create: `supabase/migrations/20261021000003_access_rls.sql`
- Test: `supabase/tests/03_access_rls.test.sql`

**Interfaces:**
- Consumes: funções da Task 3.
- Produces: RLS ligado nas sete tabelas; trigger `audit_row()`; trigger `guard_profile_changes()`; trigger `guard_system_role()`; bucket `avatars`. Códigos de erro levantados (a interface traduz na Task 7): `OXYN_FORBIDDEN_FIELD`, `OXYN_SELF_LOCKOUT`, `OXYN_LAST_SUPER_ADMIN`, `OXYN_SYSTEM_ROLE`.

**Políticas** (todas `to authenticated`):

| Tabela | select | insert / update / delete |
|---|---|---|
| `companies` | `has_company_access(id)` | `is_super_admin()` |
| `profiles` | `id = auth.uid()` ou `is_super_admin()` ou divide alguma empresa com o usuário (exists memberships m1, m2 com mesmo company_id) | update: `id = auth.uid()` ou `is_super_admin()`; insert e delete: ninguém (trigger e cascade cuidam) |
| `roles` | `current_user_active()` | `is_super_admin()` |
| `teams`, `team_members` | `current_user_active()` | `is_super_admin()` |
| `memberships` | `user_id = auth.uid()` ou `has_company_access(company_id)` | `is_super_admin()` |
| `audit_log` | `is_super_admin()` | ninguém (só triggers `security definer`) |

**Guardas:**
- `guard_profile_changes()` (before update em `profiles`): quem não é admin geral não pode alterar `is_super_admin`, `active` nem `email` → `OXYN_FORBIDDEN_FIELD`. Quando `auth.uid() = id`, mudar o próprio `active` ou `is_super_admin` para false → `OXYN_SELF_LOCKOUT`. Em qualquer caso (inclusive sem `auth.uid()`, como em scripts com service role), se a alteração deixaria zero perfis com `is_super_admin and active` → `OXYN_LAST_SUPER_ADMIN`.
- `guard_system_role()` (before update ou delete em `roles`): linha com `is_system` não pode ser excluída nem ter `name` ou `is_system` alterados → `OXYN_SYSTEM_ROLE`. As permissões dela podem ser editadas.
- `audit_row()` (after insert, update, delete, `security definer`): grava em `audit_log` com `actor_id = auth.uid()`, ligado a `companies`, `roles`, `teams`, `team_members` (record_id = team_id), `memberships`, `profiles` (só update).
- Storage: bucket `avatars` público para leitura; insert, update e delete só em objetos cujo primeiro segmento do caminho é `auth.uid()::text`.

- [ ] **Step 1: Escrever o teste pgTAP que falha**

Reaproveitar a mesma fixture da Task 3 (copiar o bloco; cada arquivo pgTAP roda isolado). Casos:
- `bruno` vê só `volt` em `companies` (`results_eq` com a lista de slugs); `admin` vê `volt` e `naia`.
- `bruno` não consegue inserir company (`throws_ok` com `42501`).
- `bruno` vê o próprio profile e os de `ana` e `caio` (mesma empresa); não vê um usuário que só está em `naia`.
- `bruno` atualiza o próprio `full_name` → ok; tenta `is_super_admin = true` → `OXYN_FORBIDDEN_FIELD`.
- `admin` tenta desativar a si mesmo → `OXYN_SELF_LOCKOUT`; com um segundo admin `admin2`, `admin` desativa `admin2` → ok; depois, como `postgres` (sem `auth.uid()`), `update profiles set active = false where id = admin` → `OXYN_LAST_SUPER_ADMIN`.
- `admin` exclui o papel `Usuário padrão` → `OXYN_SYSTEM_ROLE`; renomeia → `OXYN_SYSTEM_ROLE`; altera as permissões → ok.
- `admin` exclui o papel `Equipe` (em uso por `ana`) → `23503`.
- `bruno` lê `audit_log` → 0 linhas; após `admin` criar uma empresa, `audit_log` tem 1 linha `('companies', 'insert')` com `actor_id = admin`.
- `inativo` lê `companies` → 0 linhas.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm supabase db reset && pnpm test:db`
Expected: FAIL em `03_access_rls.test.sql`.

- [ ] **Step 3: Implementar a migração**

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm supabase db reset && pnpm test:db`
Expected: PASS nos arquivos 01, 02 e 03.

- [ ] **Step 5: Seed local**

`supabase/seed.sql`: cria em `auth.users` (com `crypt('oxyn-dev-123', gen_salt('bf'))`, `email_confirmed_at = now()` e linha correspondente em `auth.identities`) o admin `admin@oxyn.test`, marca `is_super_admin = true`, e cria as empresas `oxyn` ("Oxyn") e `volt` ("Volt"). Run: `pnpm supabase db reset` → Expected: sem erro, e login com essas credenciais funciona no Studio.

- [ ] **Step 6: Commitar**

```bash
git add supabase
git commit -m "feat(db): RLS, guardas e auditoria do acesso"
```

---

### Task 5: Tema, clientes Supabase e autenticação

**Files:**
- Create: `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/supabase/{server,client,admin,middleware}.ts`, `src/middleware.ts`, `src/lib/auth/session.ts`, `src/app/(auth)/entrar/page.tsx`, `src/app/(auth)/recuperar-senha/page.tsx`, `src/app/(auth)/definir-senha/page.tsx`, `src/app/auth/confirm/route.ts`, `src/app/auth/callback/route.ts`, `supabase/templates/invite.html`, `supabase/templates/recovery.html`, `src/lib/auth/redirect.ts`
- Modify: `supabase/config.toml` (templates)
- Test: `src/lib/auth/redirect.test.ts`, `e2e/helpers/mailpit.ts`, `e2e/helpers/auth.ts`, `e2e/auth.spec.ts`

**Interfaces:**
- Produces:
  - `createServerClient(): Promise<SupabaseClient>` (`lib/supabase/server.ts`, cookies do Next); `createBrowserClient(): SupabaseClient` (`client.ts`); `createAdminClient(): SupabaseClient` (`admin.ts`, `import "server-only"`, service role).
  - `type Profile = { id: string; fullName: string; email: string; avatarUrl: string | null; isSuperAdmin: boolean; active: boolean }`
  - `getCurrentProfile(): Promise<Profile | null>`, `requireUser(): Promise<Profile>` (sem sessão → `redirect("/entrar")`; inativo → `signOut` e `redirect("/entrar?erro=inativo")`), `requireSuperAdmin(): Promise<Profile>` (não admin → `notFound()`), em `lib/auth/session.ts`.
  - `safeNext(next: string | null): string` em `lib/auth/redirect.ts`: aceita só caminhos internos que começam com `/` e não com `//`; caso contrário devolve `/`.
  - `e2e/helpers/mailpit.ts`: `getLatestLink(to: string): Promise<string>` (API Mailpit em `http://127.0.0.1:54324/api/v1`, espera até 10 s, devolve o primeiro href com `/auth/confirm`).
  - `e2e/helpers/auth.ts`: `login(page, email, password)`, `createTestUser(opts: { email: string; password: string; fullName: string; superAdmin?: boolean }): Promise<string>` (via service role, devolve o id).

**Decisões:**
- Tokens de tema em `globals.css` (`@theme` do Tailwind v4): `--color-brand: #1A82A2`, `--color-brand-2: #6498A8`, `--color-brand-3: #75ACBA`, `--color-sidebar: #111D17`, `--color-ink: #06090F`, `--color-ink-2: #0C0C0C`. Mapear as variáveis do shadcn (`--primary`, `--ring`, `--sidebar` etc.) para esses tokens. Modo escuro (classe `dark`, `next-themes`) usa `#06090F` como fundo e `#0C0C0C` em cartões. `--destructive` vermelho neutro (`#DC2626`).
- `layout.tsx` carrega Montserrat (`--font-heading`, pesos 600 e 700) e Inter (`--font-sans`) por `next/font/google`; `lang="pt-BR"`.
- Middleware: renova a sessão (padrão `@supabase/ssr`) e redireciona quem não tem sessão para `/entrar?next=<caminho>`. Rotas públicas: `/entrar`, `/recuperar-senha`, `/auth/confirm`, `/auth/callback`. Matcher ignora `_next`, arquivos estáticos e imagens.
- Templates de e-mail com link `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/definir-senha` (e `type=recovery`). Assuntos: "Seu acesso ao Oxyn CRM" e "Redefinição de senha do Oxyn CRM". Visual: fundo `#111D17`, botão teal.
- `/auth/confirm`: `verifyOtp({ type, token_hash })`, sucesso → `redirect(safeNext(next))`, falha → `/entrar?erro=link`.
- `/entrar`: e-mail, senha, botão "Entrar", botão "Entrar com Google" (`signInWithOAuth({ provider: "google", options: { redirectTo: SITE_URL + "/auth/callback" } })`), link "Esqueci minha senha". Mensagens para `?erro=`: `inativo` → "Seu acesso foi desativado. Fale com o administrador."; `link` → "Este link expirou ou já foi usado. Peça um novo."; credencial inválida → "E-mail ou senha incorretos."; Google sem convite → "Este e-mail não tem convite para o Oxyn CRM."
- `/recuperar-senha`: `resetPasswordForEmail(email, { redirectTo: SITE_URL + "/auth/confirm?next=/definir-senha" })`; sempre mostra "Se o e-mail estiver cadastrado, você vai receber um link." (não revela se existe).
- `/definir-senha`: exige sessão; nova senha (mínimo 8 caracteres) e confirmação; `updateUser({ password })`; depois `redirect("/")`.
- Layout das telas de auth: painel esquerdo `#111D17` com `oxyn_mark.png` (copiar de `~/Claude/Projects/Oxyn/_scratch_assets/oxyn_mark.png` para `public/oxyn-mark.png`), painel direito claro com o formulário.

- [ ] **Step 1: Teste unitário que falha**

`redirect.test.ts`: `safeNext("/volt/inicio")` → `"/volt/inicio"`; `safeNext(null)` → `"/"`; `safeNext("https://evil.com")` → `"/"`; `safeNext("//evil.com")` → `"/"`; `safeNext("/\\evil.com")` → `"/"`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/lib/auth/redirect.test.ts` → Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `safeNext`, clientes, sessão, middleware, tema e páginas**

- [ ] **Step 4: Rodar o unitário**

Run: `pnpm test` → Expected: PASS.

- [ ] **Step 5: Testes E2E que falham, depois passam**

`e2e/auth.spec.ts`:
- `"login com credenciais válidas leva para a área logada"`: `createTestUser` → `login` → `expect(page).not.toHaveURL(/entrar/)`.
- `"senha errada mostra mensagem"`: `expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible()`.
- `"rota protegida sem sessão redireciona com next"`: `goto("/configuracoes/empresas")` → URL contém `/entrar?next=%2Fconfiguracoes%2Fempresas`.
- `"recuperação de senha pelo e-mail"`: pede link → `getLatestLink` → abre → define `"nova-senha-123"` → sai → entra com a nova senha.
- `"sair encerra a sessão"`: menu do usuário → "Sair" → `goto("/")` volta para `/entrar`.

Run: `pnpm test:e2e e2e/auth.spec.ts` → Expected: PASS (o destino pós-login pode ser `/sem-acesso` até a Task 6; os testes só checam que saiu de `/entrar`).

- [ ] **Step 6: Commitar**

```bash
git add -A
git commit -m "feat(auth): login, recuperação de senha, tema Oxyn e middleware"
```

---

### Task 6: Shell do app e escopo de empresa

**Files:**
- Create: `src/lib/companies/scope.ts`, `src/lib/nav.ts`, `src/app/page.tsx`, `src/app/sem-acesso/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/[empresa]/layout.tsx`, `src/app/(app)/[empresa]/inicio/page.tsx`, `src/components/shell/{sidebar,topbar,company-switcher,command-palette,quick-create,theme-toggle,user-menu}.tsx`
- Test: `src/lib/companies/scope.test.ts`, `src/lib/nav.test.ts`, `e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `requireUser`, `createServerClient` (Task 5).
- Produces:
  - `type CompanySummary = { id: string; name: string; slug: string; logoUrl: string | null }`
  - `type CompanyScope = { kind: "all" } | { kind: "company"; company: CompanySummary }`
  - `ALL_COMPANIES_SLUG = "todas"`
  - `resolveCompanyScope(param: string, companies: CompanySummary[], isSuperAdmin: boolean): CompanyScope | null` — `"todas"` vale se `isSuperAdmin` ou `companies.length >= 2`; slug vale se está em `companies`; senão `null`.
  - `switchCompanyPath(pathname: string, newSlug: string): string` — troca só o primeiro segmento quando ele é um slug de empresa (`/volt/inicio` → `/naia/inicio`); para caminhos fora do escopo (`/perfil`, `/configuracoes/...`) devolve `/<newSlug>/inicio`.
  - `pickDefaultCompany(companies: CompanySummary[], lastSlug: string | undefined): CompanySummary | null`
  - `getAccessibleCompanies(): Promise<CompanySummary[]>` (select em `companies` com `archived_at is null`, ordenado por nome; o RLS filtra).
  - `lib/nav.ts`: `CURRENT_PHASE = 1`; `type NavItem = { key: string; label: string; icon: LucideIcon; path: string; availableFromPhase: number; superAdminOnly?: boolean; scoped: boolean }`; `NAV_ITEMS: NavItem[]`; `navHref(item: NavItem, scopeSlug: string): string`; `isNavItemEnabled(item: NavItem, isSuperAdmin: boolean): boolean`.
  - Cookie `oxyn_last_company` com o último slug usado (gravado no layout `[empresa]`).

**`NAV_ITEMS`, nesta ordem:** Leads (`/leads`, fase 2, `Inbox`), Negócios (`/negocios`, fase 3, `KanbanSquare`), Atividades (`/atividades`, fase 4, `CalendarCheck`), Contatos (`/contatos`, fase 2, `Users`), E-mail (`/email`, fase 5, `Mail`), Relatórios (`/relatorios`, fase 6, `BarChart3`), Configurações (`/configuracoes/empresas`, fase 1, `Settings`, `superAdminOnly`, `scoped: false`). Os demais são `scoped: true`.

**Comportamento:**
- `/` → sem empresas → `/sem-acesso`; senão `redirect(/<pickDefaultCompany(...).slug>/inicio)`.
- `[empresa]/layout.tsx`: `resolveCompanyScope` → `null` → `notFound()`.
- `/sem-acesso`: título "Você ainda não tem acesso a nenhuma empresa", texto "Peça ao administrador para liberar seu acesso.", botão "Sair". Admin geral sem empresas é redirecionado para `/configuracoes/empresas`.
- Sidebar: 64 px de largura, fundo `--color-sidebar`, logo no topo (link para a empresa atual em `/inicio`), ícones com tooltip; item ativo com fundo teal; itens de fases futuras em opacidade reduzida, sem link, tooltip "Disponível em breve"; Configurações só para admin geral.
- Topbar: `CompanySwitcher` (lista de empresas + "Todas as empresas" quando permitido, usa `switchCompanyPath`), campo de busca que abre o `CommandPalette` (também `Ctrl/Cmd+K`; grupos "Empresas" e "Ir para" com os itens habilitados), `QuickCreate` ("+", itens para admin geral: "Nova empresa" → `/configuracoes/empresas?novo=1`, "Convidar usuário" → `/configuracoes/usuarios?convidar=1`; escondido quando não há itens), `ThemeToggle`, `UserMenu` (Perfil, Sair).
- `/[empresa]/inicio`: título com o nome da empresa (ou "Todas as empresas"), saudação "Olá, <primeiro nome>" e cartão "Sua equipe nesta empresa" com a contagem de pessoas com acesso.

- [ ] **Step 1: Testes unitários que falham**

`scope.test.ts` com `companies = [volt, naia]`:
- `resolveCompanyScope("volt", companies, false)` → `{ kind: "company", company: volt }`.
- `resolveCompanyScope("harpix", companies, false)` → `null`.
- `resolveCompanyScope("todas", [volt], false)` → `null`; `("todas", [volt], true)` → `{ kind: "all" }`; `("todas", companies, false)` → `{ kind: "all" }`.
- `switchCompanyPath("/volt/inicio", "naia")` → `"/naia/inicio"`; `("/volt/negocios/123", "todas")` → `"/todas/negocios/123"`; `("/perfil", "naia")` → `"/naia/inicio"`.
- `pickDefaultCompany(companies, "naia")` → naia; `(companies, "sumiu")` → volt (primeira); `([], undefined)` → `null`.

`nav.test.ts`: com `CURRENT_PHASE = 1`, `isNavItemEnabled(leads, true)` → false; `isNavItemEnabled(config, false)` → false; `isNavItemEnabled(config, true)` → true; `navHref(leads, "volt")` → `"/volt/leads"`; `navHref(config, "volt")` → `"/configuracoes/empresas"`.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test` → FAIL.

- [ ] **Step 3: Implementar funções puras, layouts e componentes**

Componentes shadcn necessários: `pnpm dlx shadcn@latest add button dropdown-menu tooltip command dialog avatar separator sheet sonner`.

- [ ] **Step 4: Rodar unitários** — `pnpm test` → PASS.

- [ ] **Step 5: Testes E2E**

`e2e/shell.spec.ts` (usuários criados por service role com memberships diretas no banco):
- `"usuário sem empresa vê tela de sem acesso"` → texto "Você ainda não tem acesso a nenhuma empresa".
- `"usuário com uma empresa cai direto nela"` → URL `/volt/inicio`, título "Volt"; seletor não oferece "Todas as empresas".
- `"empresa sem acesso, arquivada ou inexistente dá 404 igual"`: `goto("/naia/inicio")`, `goto("/arquivada/inicio")`, `goto("/nao-existe/inicio")` → as três páginas mostram o mesmo texto de 404 e status 404.
- `"trocar empresa mantém a seção"`: usuário com volt e naia, em `/volt/inicio` troca para Naia → `/naia/inicio`.
- `"itens de fases futuras ficam desabilitados"`: `getByRole("link", { name: "Leads" })` não existe; tooltip "Disponível em breve" aparece no hover.
- `"Configurações só aparece para admin geral"`.

Run: `pnpm test:e2e e2e/shell.spec.ts` → PASS.

- [ ] **Step 6: Commitar**

```bash
git add -A
git commit -m "feat(shell): layout base, seletor de empresa e navegação"
```

---

### Task 7: Configurações de empresas

**Files:**
- Create: `src/lib/companies/{slug,cnpj,schema,actions}.ts`, `src/lib/db-errors.ts`, `src/app/(app)/configuracoes/layout.tsx`, `src/app/(app)/configuracoes/empresas/page.tsx`, `src/components/settings/company-form.tsx`, `src/components/settings/settings-nav.tsx`
- Test: `src/lib/companies/slug.test.ts`, `src/lib/companies/cnpj.test.ts`, `src/lib/db-errors.test.ts`, `e2e/companies.spec.ts`

**Interfaces:**
- Consumes: `requireSuperAdmin`, `createServerClient`.
- Produces:
  - `slugify(name: string): string` — minúsculas, sem acento, não alfanuméricos viram `-`, sem `-` duplicado nas pontas; resultado `"todas"` vira `"todas-1"`.
  - `onlyDigits(s: string): string`, `isValidCnpj(cnpj: string): boolean` (14 dígitos, dígitos verificadores, rejeita todos iguais), `formatCnpj(digits: string): string`.
  - `companySchema` (zod): `name` 2 a 80, `slug` regex da Task 2 e diferente de `todas`, `legalName` opcional, `cnpj` opcional validado com `isValidCnpj` e normalizado para dígitos.
  - Server actions (`"use server"`, todas chamam `requireSuperAdmin()` e usam o cliente com a sessão): `createCompany(input): Promise<ActionResult<{ slug: string }>>`, `updateCompany(id: string, input): Promise<ActionResult>`, `setCompanyArchived(id: string, archived: boolean): Promise<ActionResult>`.
  - `type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> }` em `lib/db-errors.ts`.
  - `translateDbError(err: { code?: string; message?: string }): string` em `lib/db-errors.ts`. Mapeamento: `23505` → "Já existe um registro com esse valor."; `23503` → "Este registro está em uso e não pode ser excluído."; `42501` → "Você não tem permissão para esta ação."; mensagem contendo `OXYN_LAST_SUPER_ADMIN` → "É preciso manter pelo menos um administrador geral ativo."; `OXYN_SELF_LOCKOUT` → "Você não pode remover o seu próprio acesso de administrador."; `OXYN_SYSTEM_ROLE` → "O papel padrão do sistema não pode ser excluído nem renomeado."; `OXYN_FORBIDDEN_FIELD` → "Você não tem permissão para alterar este campo."; qualquer outro → "Não foi possível concluir. Tente novamente."

**Tela:**
- `configuracoes/layout.tsx`: `requireSuperAdmin()`; menu lateral secundário com Empresas, Usuários, Papéis, Equipes.
- `/configuracoes/empresas`: tabela com Nome, Slug, CNPJ (formatado), Pessoas com acesso, Status (Ativa ou Arquivada); botão "Nova empresa" (abre também com `?novo=1`); dialog com nome, slug (preenchido por `slugify` enquanto o usuário não editar), razão social, CNPJ com máscara. Ação "Arquivar" com confirmação "Arquivar <nome>? Ninguém além dos administradores gerais vai conseguir acessar." e "Reativar".
- Erro de slug duplicado aparece no campo slug: "Este endereço já está em uso."

- [ ] **Step 1: Testes unitários que falham**

- `slugify("Harpix Indústria")` → `"harpix-industria"`; `slugify("  Volt  S/A ")` → `"volt-s-a"`; `slugify("Todas")` → `"todas-1"`.
- `isValidCnpj("11.222.333/0001-81")` → true; `("11222333000181")` → true; `("11.222.333/0001-82")` → false; `("00000000000000")` → false; `("123")` → false.
- `formatCnpj("11222333000181")` → `"11.222.333/0001-81"`.
- `translateDbError({ code: "23503" })` → texto acima; `({ message: "OXYN_LAST_SUPER_ADMIN" })` → texto acima; `({ code: "XX000" })` → texto genérico.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test` → FAIL.

- [ ] **Step 3: Implementar funções, actions e tela**

Componentes: `pnpm dlx shadcn@latest add table input label form alert-dialog badge`.

- [ ] **Step 4: Rodar unitários** — `pnpm test` → PASS.

- [ ] **Step 5: E2E**

`e2e/companies.spec.ts` (admin do seed):
- `"cria empresa com slug automático"`: "Nova empresa" → nome "Harpix Indústria" → slug mostrado `harpix-industria` → salvar → linha na tabela; o seletor de empresa passa a listar Harpix.
- `"CNPJ inválido mostra erro no campo"`: `11.222.333/0001-82` → "CNPJ inválido.".
- `"slug duplicado mostra erro no campo"`: slug `volt` → "Este endereço já está em uso.".
- `"arquivar esconde a empresa do seletor"`.

Run: `pnpm test:e2e e2e/companies.spec.ts` → PASS.

- [ ] **Step 6: Commitar**

```bash
git add -A
git commit -m "feat(config): cadastro de empresas"
```

---

### Task 8: Configurações de papéis

**Files:**
- Create: `src/lib/permissions/{schema,labels}.ts`, `src/lib/roles/actions.ts`, `src/app/(app)/configuracoes/papeis/page.tsx`, `src/app/(app)/configuracoes/papeis/[id]/page.tsx`, `src/components/settings/role-editor.tsx`
- Test: `src/lib/permissions/schema.test.ts`, `e2e/roles.spec.ts`

**Interfaces:**
- Produces:
  - `ENTITIES = ["leads", "deals", "persons", "organizations", "activities"] as const`; `VISIBILITY = ["own", "team", "company"] as const`; `ACTIONS = ["create", "edit", "delete", "export", "reassign_owner"] as const`; `SETTINGS = ["manage_pipelines", "manage_custom_fields", "manage_products", "view_reports", "create_dashboards", "share_dashboards"] as const`.
  - `permissionsSchema` (zod `.strict()` em todos os níveis, espelha `is_valid_permissions`); `type Permissions = z.infer<typeof permissionsSchema>`.
  - `DEFAULT_PERMISSIONS: Permissions` (igual ao "Usuário padrão" da Task 2).
  - `PERMISSION_LABELS`: entidades (Leads, Negócios, Pessoas, Organizações, Atividades); visibilidade (Só os meus, Da minha equipe, Toda a empresa); ações (Criar, Editar, Excluir, Exportar, Reatribuir responsável); configurações (Editar funis e etapas, Editar campos personalizados, Editar produtos, Ver relatórios, Criar dashboards, Compartilhar dashboards).
  - Actions: `createRole({ name, description }): Promise<ActionResult<{ id: string }>>` (nasce com `DEFAULT_PERMISSIONS`), `updateRole(id, { name, description, permissions }): Promise<ActionResult>`, `deleteRole(id): Promise<ActionResult>`.

**Tela:**
- `/configuracoes/papeis`: lista com Nome, Descrição, Acessos usando o papel; o papel do sistema tem selo "Padrão do sistema" e não mostra "Excluir".
- `/configuracoes/papeis/[id]`: três seções com títulos em Montserrat. **Visibilidade:** uma linha por entidade com controle segmentado de três opções. **Ações** e **Configurações:** um interruptor por chave com o rótulo. Botão "Salvar alterações" desabilitado até haver mudança.
- Excluir papel em uso: "Este papel está em uso por N acessos. Troque o papel dessas pessoas antes de excluir." (singular quando N = 1: "1 acesso") (contar memberships antes de tentar; o `23503` do banco continua como rede de segurança).

- [ ] **Step 1: Testes unitários que falham**

- `permissionsSchema.parse(DEFAULT_PERMISSIONS)` não lança.
- `safeParse` falha para: visibilidade `"all"`; sem `settings.share_dashboards`; chave extra `actions.foo`; `actions.create = "true"`.
- `Object.keys(DEFAULT_PERMISSIONS.visibility)` igual a `ENTITIES` e todos `"own"`.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test` → FAIL.

- [ ] **Step 3: Implementar**

Componentes: `pnpm dlx shadcn@latest add switch toggle-group textarea`.

- [ ] **Step 4: Rodar unitários** — `pnpm test` → PASS.

- [ ] **Step 5: E2E**

`e2e/roles.spec.ts`:
- `"cria papel e ajusta permissões"`: cria "Líder de conta" → em Negócios escolhe "Toda a empresa" → liga "Reatribuir responsável" → salva → recarrega → valores persistem.
- `"papel do sistema não pode ser excluído"`: linha "Usuário padrão" sem botão "Excluir".
- `"papel em uso não pode ser excluído"`: papel com uma membership criada no banco → "Excluir" → mensagem "Este papel está em uso por 1 acesso…".

Run: `pnpm test:e2e e2e/roles.spec.ts` → PASS.

- [ ] **Step 6: Commitar**

```bash
git add -A
git commit -m "feat(config): papéis com permissões configuráveis"
```

---

### Task 9: Configurações de equipes

**Files:**
- Create: `src/lib/teams/actions.ts`, `src/app/(app)/configuracoes/equipes/page.tsx`, `src/components/settings/team-form.tsx`
- Test: `e2e/teams.spec.ts`

**Interfaces:**
- Produces: `createTeam({ name }): Promise<ActionResult<{ id: string }>>`, `renameTeam(id, name): Promise<ActionResult>`, `deleteTeam(id): Promise<ActionResult>`, `setTeamMembers(teamId: string, userIds: string[]): Promise<ActionResult>` (substitui a lista: apaga ausentes, insere novos).

**Tela:** `/configuracoes/equipes` com cartões por equipe (nome, avatares dos membros, contagem); dialog de edição com nome e multisseleção de usuários ativos (busca por nome ou e-mail). Excluir equipe pede confirmação "Excluir <nome>? A visibilidade 'Da minha equipe' deixa de considerar esse grupo."

- [ ] **Step 1: E2E que falha**

`e2e/teams.spec.ts`:
- `"cria equipe e adiciona membros"`: "Nova equipe" → "Time SDR" → adiciona dois usuários → salvar → cartão mostra "2 pessoas".
- `"remover membro atualiza a contagem"`.
- `"nome duplicado mostra erro"` → "Já existe um registro com esse valor.".

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test:e2e e2e/teams.spec.ts` → FAIL.

- [ ] **Step 3: Implementar** (shadcn: `pnpm dlx shadcn@latest add card popover checkbox`)

- [ ] **Step 4: Rodar e ver passar** — `pnpm test:e2e e2e/teams.spec.ts` → PASS.

- [ ] **Step 5: Commitar**

```bash
git add -A
git commit -m "feat(config): equipes"
```

---

### Task 10: Configurações de usuários e convites

**Files:**
- Create: `src/lib/users/{schema,actions}.ts`, `src/app/(app)/configuracoes/usuarios/page.tsx`, `src/components/settings/{invite-user-dialog,user-drawer,access-rows}.tsx`
- Test: `src/lib/users/schema.test.ts`, `e2e/users.spec.ts`

**Interfaces:**
- Consumes: `createAdminClient`, `requireSuperAdmin`, `translateDbError`, `getLatestLink` (E2E).
- Produces:
  - `accessSchema = z.object({ companyId: z.string().uuid(), roleId: z.string().uuid() })`
  - `inviteSchema = z.object({ email: z.string().email(), fullName: z.string().min(2).max(80), isSuperAdmin: z.boolean(), access: z.array(accessSchema), teamIds: z.array(z.string().uuid()) })` com refinamento: `companyId` sem repetição ("Esta empresa já foi adicionada."); `access` vazio só é permitido se `isSuperAdmin`.
  - `inviteUser(input): Promise<ActionResult<{ userId: string }>>`: `admin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: SITE_URL + "/auth/confirm?next=/definir-senha" })`; erro de e-mail existente → "Já existe um usuário com este e-mail."; depois, com o cliente da sessão: `is_super_admin` no profile, insert em `memberships` e `team_members`. Se algum insert falhar, apaga o usuário criado (`admin.auth.admin.deleteUser`) e devolve o erro.
  - `setUserAccess(userId: string, access: Access[]): Promise<ActionResult>` (substitui a lista).
  - `setUserTeams(userId: string, teamIds: string[]): Promise<ActionResult>`.
  - `setSuperAdmin(userId: string, value: boolean): Promise<ActionResult>`.
  - `setUserActive(userId: string, active: boolean): Promise<ActionResult>`: atualiza `profiles.active` com o cliente da sessão (o banco aplica as guardas) e então `admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" })`. Recusa `userId === eu` antes de chamar o banco.
  - `resendInvite(userId: string): Promise<ActionResult>`: `resetPasswordForEmail(email, { redirectTo: SITE_URL + "/auth/confirm?next=/definir-senha" })`.
  - `listUsers(): Promise<UserRow[]>` com `type UserRow = { id; fullName; email; avatarUrl; isSuperAdmin; active; pending: boolean; access: { companyName; roleName }[]; teams: string[] }`; `pending` vem de `email_confirmed_at is null` via `admin.auth.admin.listUsers` (só no servidor).

**Tela:**
- `/configuracoes/usuarios`: tabela com Nome (avatar), E-mail, Empresas e papéis ("Volt · Líder de conta"), Equipes, Status (selos "Ativo", "Convite pendente", "Inativo"), selo "Admin geral". Filtro por empresa e por status. Botão "Convidar usuário" (abre também com `?convidar=1`).
- Dialog de convite: nome, e-mail, interruptor "Administrador geral", linhas de acesso (empresa + papel, "Adicionar empresa"), equipes.
- Drawer de edição: mesmos campos (e-mail só leitura), "Reenviar convite" quando pendente, "Desativar acesso" ou "Reativar acesso" com confirmação "Desativar <nome>? A pessoa perde o acesso na hora. Os registros dela continuam no sistema." Ações sobre si mesmo ficam desabilitadas com tooltip "Você não pode alterar o seu próprio acesso.".

- [ ] **Step 1: Testes unitários que falham**

`schema.test.ts`:
- convite válido com uma empresa → ok.
- duas linhas com o mesmo `companyId` → erro "Esta empresa já foi adicionada.".
- `access: []` com `isSuperAdmin: false` → erro; com `true` → ok.
- e-mail `"ana@"` → erro.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test` → FAIL.

- [ ] **Step 3: Implementar actions e telas**

Componentes: `pnpm dlx shadcn@latest add select`.

- [ ] **Step 4: Rodar unitários** — `pnpm test` → PASS.

- [ ] **Step 5: E2E**

`e2e/users.spec.ts` (admin do seed; papéis e empresas criados por service role no `beforeAll`):
- `"convite completo: usuário define senha e vê só a empresa liberada"`: convida `sdr+<timestamp>@oxyn.test` com acesso a Volt como "Usuário padrão" → tabela mostra "Convite pendente" → `getLatestLink` → define senha → cai em `/volt/inicio` → o seletor não lista Oxyn → `goto("/oxyn/inicio")` dá 404.
- `"e-mail já cadastrado mostra erro"` → "Já existe um usuário com este e-mail.".
- `"desativar derruba a sessão aberta"`: abre um segundo `browser.newContext()` logado como o usuário convidado; admin desativa; no segundo contexto `page.reload()` → URL `/entrar?erro=inativo` e mensagem "Seu acesso foi desativado. Fale com o administrador.".
- `"admin não consegue se desativar"`: linha do próprio admin com "Desativar acesso" desabilitado.
- `"tornar e remover outro admin geral"`: admin liga "Administrador geral" no usuário convidado → selo "Admin geral" aparece → desliga → selo some. (O bloqueio do último admin é coberto no pgTAP da Task 4.)
- `"reenviar convite gera novo link"`.

Run: `pnpm test:e2e e2e/users.spec.ts` → PASS.

- [ ] **Step 6: Commitar**

```bash
git add -A
git commit -m "feat(config): usuários, convites e desativação"
```

---

### Task 11: Perfil do usuário

**Files:**
- Create: `src/app/(app)/perfil/page.tsx`, `src/components/profile/{profile-form,avatar-upload,password-form}.tsx`, `src/lib/profile/actions.ts`
- Test: `e2e/profile.spec.ts`

**Interfaces:**
- Produces: `updateProfile({ fullName }): Promise<ActionResult>`, `uploadAvatar(file: File): Promise<ActionResult<{ url: string }>>` (caminho `avatars/<uid>/<timestamp>.<ext>`, aceita `image/png`, `image/jpeg`, `image/webp` até 2 MB; mensagem "Envie uma imagem PNG, JPG ou WebP de até 2 MB."), `changePassword({ password, confirm }): Promise<ActionResult>` (mínimo 8, iguais: "As senhas não conferem.").

**Tela:** `/perfil` com três cartões: Dados (nome, e-mail só leitura), Foto (avatar com botão "Trocar foto"), Senha (nova senha e confirmação), mais a preferência de tema (Claro, Escuro, Sistema) do `next-themes`.

- [ ] **Step 1: E2E que falha**

`e2e/profile.spec.ts`:
- `"altera o nome e ele aparece no menu"`.
- `"troca a foto"`: `setInputFiles` com PNG de `e2e/fixtures/avatar.png` → `img` do menu do usuário passa a apontar para `/storage/v1/object/public/avatars/<uid>/`.
- `"arquivo grande é recusado"`: arquivo de 3 MB → mensagem acima.
- `"troca a senha"`: muda → sai → entra com a nova.

- [ ] **Step 2: Rodar e ver falhar** — `pnpm test:e2e e2e/profile.spec.ts` → FAIL.

- [ ] **Step 3: Implementar**

- [ ] **Step 4: Rodar e ver passar** — `pnpm test:e2e e2e/profile.spec.ts` → PASS.

- [ ] **Step 5: Commitar**

```bash
git add -A
git commit -m "feat(perfil): dados, foto e senha"
```

---

### Task 12: Bootstrap do primeiro admin e guia de implantação

**Files:**
- Create: `scripts/bootstrap-admin.ts`, `README.md`
- Modify: `package.json` (script `"bootstrap:admin": "tsx scripts/bootstrap-admin.ts"`)

**Interfaces:**
- Produces: `pnpm bootstrap:admin <email> "<Nome>"`, lendo `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SITE_URL` do ambiente. Convida o e-mail (mesmo `redirectTo` da Task 10) e marca `is_super_admin = true`. Se o usuário já existe, só marca o admin. Imprime "Admin geral pronto: <email>. Convite enviado." ou "Admin geral pronto: <email>. Usuário já existia.". Sai com código 1 e mensagem clara se faltar variável.

- [ ] **Step 1: Verificar contra o banco local**

Run: `pnpm bootstrap:admin dono@oxyn.test "Dono Teste"`
Expected: mensagem de convite enviado; e-mail aparece no Mailpit; `select is_super_admin from profiles where email = 'dono@oxyn.test'` → `true`. Rodar de novo → mensagem "Usuário já existia.".

- [ ] **Step 2: Escrever o README**

Seções, em português:
1. **Desenvolvimento local:** pré-requisitos (Node 22, pnpm, Docker), `pnpm install`, `pnpm supabase start`, copiar chaves para `.env.local`, `pnpm supabase db reset`, `pnpm dev`, login `admin@oxyn.test` / `oxyn-dev-123`, Mailpit em `http://127.0.0.1:54324`.
2. **Testes:** `pnpm test`, `pnpm test:db`, `pnpm test:e2e`.
3. **Produção:** `pnpm supabase link --project-ref <ref>`; `pnpm supabase db push`; no painel do Supabase, Auth: desligar "Allow new users to sign up", definir Site URL e Redirect URLs (`/auth/confirm`, `/auth/callback`), colar os templates de `supabase/templates`, configurar SMTP com o Resend; habilitar Google com client id e secret do projeto Google Cloud da Oxyn (redirect `https://<ref>.supabase.co/auth/v1/callback`).
4. **Vercel:** importar o repositório, variáveis `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`.
5. **Primeiro acesso:** `pnpm bootstrap:admin caiocamarini@… "Caio Camarini"` com as variáveis de produção.

- [ ] **Step 3: Verificação completa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm supabase db reset && pnpm test:db && pnpm build && pnpm test:e2e`
Expected: tudo passa.

- [ ] **Step 4: Commitar**

```bash
git add -A
git commit -m "docs: bootstrap do admin e guia de implantação"
```

---

## Cobertura da spec (fase 1)

| Requisito da spec | Task |
|---|---|
| Login, convite, recuperação de senha, perfil | 5, 10, 11 |
| Login com Google, sem cadastro aberto | 1 (config), 5 |
| Cadastro de empresas (admin geral) | 7 |
| Usuários: convidar, ativar/desativar, empresas e papel por empresa | 10 |
| Papéis com interruptores (5.2) | 2, 8 |
| Equipes | 9 |
| `can_access` e RLS (5.3) | 3, 4 |
| Usuário desativado perde acesso imediato | 4, 5, 10 |
| Layout: sidebar, seletor de empresa com "Todas", busca, "+", avatar, modo escuro | 5, 6 |
| Identidade visual (seção 3) | 5, 6 |
| Auditoria básica | 4 |
| Exclusão definitiva só pelo admin geral | 4 (políticas de delete só para admin geral nas tabelas de acesso; tabelas de negócio chegam nas fases seguintes) |
