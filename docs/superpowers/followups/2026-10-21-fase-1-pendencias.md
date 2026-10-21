# Fase 1: pendências e decisões

Registro gerado ao fim da execução da fase 1 (branch `feat/fase-1-fundacao`).

## Ações manuais obrigatórias

- Supabase (dev e produção): desligar "Allow new users to sign up" e definir tamanho mínimo de senha 8. `pnpm check:auth` e `pnpm bootstrap:admin` recusam rodar enquanto o cadastro aberto estiver ligado.
- Verificar as migrations 0001 a 0005 aplicadas do zero num banco limpo (projeto Supabase temporário ou o próprio projeto de produção ao ser criado) e rodar `pnpm test:db` nele. Depois disso, migrations são imutáveis: mudanças só em arquivos novos.
- Aumentar a validade do link de e-mail (Email OTP expiration) para 24 h, para convites abertos no dia seguinte.

## Decisões tomadas durante a execução

- R1: No Docker/local Supabase. Use the cloud dev project from `.env.local`. `pnpm db:migrate` = `supabase db push --db-url "$SUPABASE_DB_URL"` (if the CLI needs Docker for this, a Node script applying `supabase/migrations/*.sql` in order and recording them in `supabase_migrations.schema_migrations`). `pnpm test:db` = Node script `scripts/test-db.ts` running each `supabase/tests/*.sql` over `SUPABASE_DB_URL` (files wrap themselves in begin/rollback), ensuring `create extension if not exists pgtap with schema extensions`, failing on any `not ok` or plan mismatch. No `db reset`. `config.toml` auth settings become documentation; dashboard auth toggles go in README — user declined Docker — cost if wrong: test runner rework, small.
- R2: Auth e-mails sent by the app. `lib/email/send.ts` `sendEmail({ to, subject, html })`: `EMAIL_TRANSPORT=file` (default when unset in dev/test) appends JSON line to `.e2e-outbox/emails.jsonl`; `resend` posts to Resend API with `RESEND_API_KEY`, `EMAIL_FROM`. `lib/auth/links.ts` `createAuthLink(type: "invite" | "recovery", email, opts?)` uses `admin.auth.admin.generateLink` and returns `${SITE_URL}/auth/confirm?token_hash=<hashed_token>&type=<type>&next=/definir-senha`. Templates in `lib/email/templates.ts`. Recovery = server action that swallows unknown-email errors. Invite (T10) = generateLink type invite (creates user) + sendEmail; resend invite = recovery link. E2E helper `e2e/helpers/outbox.ts` `getLatestLink(to)` replaces Mailpit. `supabase/templates/` dropped — cloud default SMTP refuses non-team recipients and is rate limited — cost if wrong: swap transport, small.
- R3: Dev seed via `scripts/seed-dev.ts` (`pnpm db:seed`) using admin API createUser (`admin@oxyn.test` / `oxyn-dev-123`, email_confirm) + idempotent upserts (super admin flag, companies `oxyn`, `volt`) instead of raw auth.users SQL — safer on hosted Auth — cost if wrong: trivial.
- R4: DB is shared by all tests and runs. pgTAP fixtures use unique slugs/emails prefixed `tst-`, assertions scoped to fixture ids (never global counts). Last-super-admin test first demotes every other super admin inside its transaction. E2E creates uniquely suffixed data and deletes what it created in afterAll — cost if wrong: flaky tests.
- R5: CI always runs lint, typecheck, vitest, build; `test:db` and `test:e2e` steps only run when repo secrets `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` exist — cost if wrong: none.
- R6: Task 2 enables RLS (no policies, deny-all) on every new table; Task 4 adds policies — hosted API exposes public tables between tasks — cost if wrong: none
- R7: can_access must return strict false, never NULL (wrap in coalesce) though brief's algorithm returns NULL for null owner — spec: deny by default, boolean contract — cost if wrong: none
- R8: edit migrations in place while the branch is unmerged (prod never ran them); re-apply changed create-or-replace functions to dev directly; schema-changing edits need a new migration file — cost if wrong: dev drift, recoverable
- R9: guard_profile_changes field guard (OXYN_FORBIDDEN_FIELD) applies only when auth.uid() is not null; service-role/postgres contexts (bootstrap, seed, triggers) may set is_super_admin/active/email; OXYN_LAST_SUPER_ADMIN applies in every context — bootstrap script (Task 12) and seed must set is_super_admin via service role — cost if wrong: service-role scripts already bypass RLS, so no new exposure
- R10: profiles "shares a company" policy uses a security definer helper (e.g. shares_company(p_other uuid)) instead of an inline join, avoiding RLS recursion on memberships — cost if wrong: none
- R11: fix all 5 Important now (open redirect; server-side password policy; recovery throttle via DB quota fn + send in background with `after()`; file transport only outside production; Google callback guard rejecting accounts created by Google sign-up without invite, deleting them) — spec: no open sign-up, DB/server is the barrier — cost if wrong: small extra migration
- R12: local E2E exhausting the shared `recovery:ip:unknown` quota is load-bearing (suite fails after 5 runs) → treat as Important: skip the IP key when no client IP header is present — cost if wrong: unknown-IP requests only limited per e-mail
- R13: shell mounts in (app)/layout.tsx; it receives accessible companies + profile from the server and derives the current scope client-side from the first path segment (usePathname) matched against those slugs, falling back to pickDefaultCompany(cookie) on unscoped pages; [empresa]/layout keeps resolveCompanyScope/notFound/cookie — plan file structure — cost if wrong: layout refactor
- R14: Task 10 invite = createAuthLink("invite", email, {fullName}) + sendEmail(inviteEmail); resendInvite = createAuthLink("recovery") + sendEmail(inviteEmail with that link) (user still pending, invite wording) — R2 — cost if wrong: copy tweak
- R15: bootstrap e-mail failure after user creation is load-bearing (first admin has nobody to resend the invite) → treat as Important: set is_super_admin before sending; on existing-but-unconfirmed user, re-send the invite (recovery link + invite e-mail) instead of only flagging — cost if wrong: one extra e-mail
- R16: final fix wave (one dispatch) = I1 automated disable_signup check (bootstrap refuses + CI step) ; I2 remove age window + log deleteUser failure ; in-place migration edits while still allowed: single is_system unique index, search_path on is_valid_permissions, revoke handle_new_user from public, reserved slugs (DB + zod), profiles full_name length + avatar_url path checks ; links.ts throws without SITE_URL ; archive dialog copy matches behavior ; test-db rollback between files ; pgTAP case for multi-row admin deactivation — cost if wrong: small
- R17: I3 (clean apply on a fresh DB) and turning off sign-up in the dev dashboard need the user (destructive dev reset or a scratch project; dashboard toggle) — surfaced at finish, not done autonomously

## Melhorias adiadas (não bloqueiam)

- Task 1: ci.yml secrets exported workflow-wide; scope to db/e2e steps
- Task 1: CI build lacks NEXT_PUBLIC_* on fork PRs
- Task 1: test-db.ts no rollback/fresh connection between files; indented TAP lines dropped
- Task 1: db-migrate passes DB URL on argv (visible in ps)
- Task 1: stock README/AGENTS.md/placeholder SVGs committed (README replaced in Task 12)
- Task 1: concurrency group keeps only latest pending run; local test runs not serialized
- Task 2: is_valid_permissions lacks set search_path; handle_new_user not revoked from PUBLIC; no single-is_system enforcement; cnpj regex \d vs [0-9]; no tests for set_updated_at / role_id restrict
- Task 3: shares_team owner-in-no-team untested; teams are global so team visibility spans companies (by design)
- Task 3: role_permissions ignores profiles.active — callers must also check current_user_active
- Task 3: super admin bypass true for null/unknown company/entity (per brief)
- Task 3: anon calling functions → permission denied; policies must be `to authenticated` (carry to Task 4)
- Task 3: heavy repeated identity-switch boilerplate in tests
- Task 3: test fixture `select … from roles where is_system` assumes exactly one system role
- Task 4: last-admin race under READ COMMITTED (lock rows before count)
- Task 4: avatars_select lets authenticated list all objects (reveals user ids); no bucket size/mime limits
- Task 4: inactive user can still update own full_name/avatar_url
- Task 4: seed-dev doesn't assert profile update affected a row
- Task 4: test 03 locks real admin rows during run (rolled back)
- Task 4: multi-row DELETE/UPDATE of all admins in one statement passes row-level guard
- Task 4: migrations edited in place (R8) — environments that recorded them won't get changes; fine pre-release, must stop once prod exists
- Task 5: signOut in Server Component can't clear cookies (inactive flow)
- Task 5: proxy redirect response doesn't copy refreshed cookies
- Task 5: proxy matcher misses robots.txt/manifest/fonts; .png paths skip refresh
- Task 5: Google redirectTo drops `next`
- Task 5: login network errors show credential message
- Task 5: links.ts silent undefined SITE_URL; confirm route doesn't whitelist `type`
- Task 5: e2e afterAll deleteTestUser(undefined) masks beforeAll errors
- Task 5: unused --color-sidebar-base; dark chart tokens grey
- Task 5: consume_email_quota count-then-insert race (add pg_advisory_xact_lock)
- Task 5: IP from first x-forwarded-for is spoofable off Vercel; prefer x-vercel-forwarded-for/x-real-ip
- Task 5: anyone can exhaust a victim's 3/15min recovery quota (inherent)
- Task 5: callback ignores deleteUser errors; EMAIL_TRANSPORT=file allowed if explicitly set in prod (deploy checklist)
- Task 6: `/` redirect inside Suspense returns 200 + client redirect
- Task 6: requireUser/getAccessibleCompanies fetched up to 3×/request; wrap in React cache()
- Task 6: UNSCOPED_ROOTS must grow with new top-level routes; only `todas` reserved in DB
- Task 6: shell e2e relies on Next default English 404 text; section-preservation only unit-tested
- Task 6: last-company cookie lacks Secure in production
- Task 6: form inside DropdownMenuItem asChild; mid-file imports in pure.ts
- Task 7: company-form hides result.error when fieldErrors has unknown keys; slug-dup detection depends on constraint name; update/archive don't assert a row changed; "Ativa" badge weight; literal combining-mark range in slugify
- Task 8: role-editor dirty check compares untrimmed values; updateRole doesn't assert a row changed; no pre-click in-use hint
- Task 9: setTeamMembers delete+insert not atomic; uuid parse throws instead of ActionResult; no "+N" avatars; accent token unverified; redundant rename on retry
- Task 10: setUserActive/inviteUser updates don't assert a row changed; rollback deleteUser errors swallowed; resendInvite doesn't verify user still pending; setUserAccess allows empty access server-side; drawer save not atomic; no E2E for self tooltip / ?convidar=1
- Task 11: replaced avatars not deleted from storage; file.type read before instanceof check
- Task 12: README doesn't say EMAIL_TRANSPORT unset → link goes to outbox; GOOGLE_CLIENT_ID/SECRET optional in dev not mentioned
