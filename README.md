# Oxyn CRM

CRM multiempresa da Oxyn (Next.js 16 e Supabase hospedado). A fase 1 entrega a fundação: login, convites, empresas, usuários, papéis com permissões, equipes e perfil.

- Especificação: [docs/superpowers/specs/2026-10-21-oxyn-crm-design.md](docs/superpowers/specs/2026-10-21-oxyn-crm-design.md)
- Plano da fase 1: [docs/superpowers/plans/2026-10-21-fase-1-fundacao.md](docs/superpowers/plans/2026-10-21-fase-1-fundacao.md)

## Desenvolvimento

Pré-requisitos: Node 22 e pnpm. Não é preciso Docker: o banco é um projeto Supabase de desenvolvimento.

1. Crie um projeto Supabase de DEV (supabase.com).
2. Copie `.env.example` para `.env.local` e preencha:
   - `NEXT_PUBLIC_SUPABASE_URL`: Project Settings > API > Project URL.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Project Settings > API Keys, chave anon (publishable).
   - `SUPABASE_SERVICE_ROLE_KEY`: Project Settings > API Keys, chave service_role (secret). Nunca exponha no navegador.
   - `SUPABASE_DB_URL`: botão Connect > Session pooler, URI com a senha do banco.
   - `NEXT_PUBLIC_SITE_URL`: `http://localhost:3000`.
3. Instale e prepare o banco:

```bash
pnpm install
pnpm db:migrate   # aplica as migrações no projeto de dev
pnpm db:seed      # admin@oxyn.test / oxyn-dev-123 e empresas Oxyn e Volt
pnpm dev
```

Em desenvolvimento os e-mails (convite, recuperação de senha) não são enviados: ficam em `.e2e-outbox/emails.jsonl`, uma mensagem JSON por linha, com o link de acesso.

## Testes

```bash
pnpm test                              # unitários
pnpm test:db                           # pgTAP no projeto de dev; cada arquivo faz rollback
pnpm exec playwright install chromium  # uma vez
pnpm test:e2e                          # ponta a ponta
```

Os testes de banco e os E2E usam o mesmo projeto de dev, com dados prefixados por `tst-`.

## Produção (Supabase)

1. Crie um projeto separado do de dev. Recomendado: região São Paulo.
2. Aplique as migrações, com a URI do Session pooler de produção:

```bash
pnpm supabase db push --db-url "<URI do pooler de produção>"
```

   Alternativa: `pnpm supabase link --project-ref <ref>` seguido de `pnpm supabase db push`.
3. No painel, em Authentication, configure (obrigatório):
   - Desligar "Allow new users to sign up". Só o admin geral convida.
   - Tamanho mínimo de senha: 8.
   - Site URL: o domínio de produção.
   - Redirect URLs: `<domínio>/auth/confirm` e `<domínio>/auth/callback`.
4. Login com Google: em Authentication > Providers, habilite Google com o client ID e o secret do cliente OAuth da Oxyn no Google Cloud. Nele, cadastre a URI de redirecionamento `https://<ref>.supabase.co/auth/v1/callback`.

Não é preciso configurar templates de e-mail no Supabase: o app envia os próprios e-mails.

## E-mail (Resend)

Configure na Vercel:

- `EMAIL_TRANSPORT=resend`
- `RESEND_API_KEY`: chave da API do Resend.
- `EMAIL_FROM`: remetente de um domínio verificado no Resend, por exemplo `Oxyn CRM <nao-responda@seudominio.com.br>`.

Em produção, sem `EMAIL_TRANSPORT` o app se recusa a enviar e-mails.

## Vercel

Importe o repositório e defina as variáveis (as mesmas de `.env.example`, com valores de produção):

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` (domínio de produção), `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`.

`SUPABASE_DB_URL` só é necessária para migrar e testar, não para o app.

## CI

O GitHub Actions (`.github/workflows/ci.yml`) roda lint, typecheck, testes unitários e build. Os passos de banco e E2E só rodam se os secrets do repositório existirem: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_DB_URL`. Eles usam o projeto de dev e as execuções são serializadas (um job por vez) para não disputar o mesmo banco.

## Primeiro acesso

Com as variáveis de produção exportadas no terminal (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `EMAIL_FROM`):

```bash
pnpm bootstrap:admin caiocamarini@gmail.com "Caio Camarini"
```

O comando convida o e-mail e marca o usuário como admin geral. Se o usuário já existir, apenas o marca como admin geral. Abra o convite recebido, crie a senha e entre.

Se o envio do e-mail falhar, o usuário já foi criado e marcado como admin geral: corrija a configuração e rode o comando de novo. Enquanto o usuário não tiver confirmado o acesso, cada nova execução reenvia o convite ("Convite reenviado."). Em desenvolvimento, com `EMAIL_TRANSPORT` vazio, o link vai para `.e2e-outbox/emails.jsonl`.
