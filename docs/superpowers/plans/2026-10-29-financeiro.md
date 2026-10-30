# Financeiro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo Financeiro no Oxyn CRM: contratos com vigência e regra de fim, despesas recorrentes, lançamentos com baixa, saldo informado, projeção de caixa e visões por cliente, serviço e custo. Negócio ganho vira contrato rascunho.

**Architecture:**
- Regras de integridade e geração de lançamentos ficam no banco (Postgres/Supabase), com triggers, funções `security definer` onde precisam furar a RLS, e testes pgTAP.
- O front (Next.js 16, server components e server actions) lê `fin_entries` filtrado pela RLS e agrega em funções puras TypeScript testadas com Vitest.
- A carga inicial é feita por dois scripts: um extrai a planilha para um JSON, que é completado com os padrões da Task 14, e o outro importa. O módulo já é entregue com a planilha carregada.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres, RLS, pg_cron), zod 4, shadcn/radix, recharts 3, Vitest, pgTAP (`pnpm test:db`), Playwright, `exceljs` (nova dependência de desenvolvimento, só no extrator).

**Spec:** [docs/superpowers/specs/2026-10-29-financeiro-design.md](../specs/2026-10-29-financeiro-design.md)

## Global Constraints

- Leia o guia relevante em `node_modules/next/dist/docs/` antes de escrever código Next (AGENTS.md: "This is NOT the Next.js you know").
- Migrations em `supabase/migrations/20261030NNNNNN_<nome>.sql`, em ordem. Testes pgTAP em `supabase/tests/NN_<nome>.test.sql`, numerados a partir de 43, no padrão de `13_deals_functions.test.sql` (`begin; select plan(n); … pg_temp.as_user …; rollback`).
- Toda tabela nova tem `company_id`, `created_at`, `created_by` (default `auth.uid()`), `updated_at` (trigger `set_updated_at`), RLS habilitada e `revoke … from anon`.
- Valores em `numeric(14,2)`. Datas de competência são o primeiro dia do mês. Fuso: America/Sao_Paulo.
- Textos de interface em português, no tom das telas existentes. Ações do servidor retornam `ActionResult` (`@/lib/db-errors`) e validam com zod, como `src/lib/products/actions.ts`.
- Páginas seguem o padrão das existentes (`export const instant = false`, `createServerClient`, `fail(...)` de `@/lib/records/list-helpers`).
- Nada do Financeiro entra no Insights, em dashboards ou em links públicos.
- Configurações de categorias de serviço: só o admin geral (`requireSuperAdmin`), como Produtos.
- Horizonte de geração: 36 meses a partir do mês corrente.
- Seeds:
  - categorias de serviço: Consultoria Vendas, Terceirização Vendas, Comissionamento, Consultoria Pessoas, Terceirização Pessoas, Serviço SEO/GEO;
  - categorias de despesa e natureza padrão: Aquisição de clientes (variable), Pró-labore (fixed), Pessoas (fixed), Comissão (variable), Escritório/administração geral (fixed), Custo de mercadorias/custo de serviços (variable), Viagens (variable), Despesas jurídicas (variable), Seguros (fixed), Tecnologia (fixed), Repasses (variable), Impostos/taxas bancárias (variable);
  - categorias de receita: Vendas, Comissão, Repasses, Investimentos/rendimentos.
- Comandos: `pnpm db:migrate`, `pnpm test:db <trecho>`, `pnpm test <arquivo>`, `pnpm test:e2e <spec>`, `pnpm typecheck`, `pnpm lint`.

## Review Focus

1. **Dia de vencimento 29–31 em mês curto.** Fevereiro e meses de 30 dias usam o último dia do mês, nunca transbordam para o mês seguinte. Teste na Task 5.
2. **Editar um contrato ou despesa já parcialmente liquidado.** A regeneração mantém os lançamentos liquidados e `locked` e não duplica a competência deles. Testes nas Tasks 5 e 6.
3. **Reabrir ou perder um negócio cujo contrato já foi ativado.** Nada é apagado, o contrato ganha `source_changed = true` e os lançamentos continuam. Teste na Task 7.
4. **Usuário sem `view_finance` (inclusive o vendedor só com `register_sales`), empresa com Financeiro desligado, ou escopo "Todas as empresas".** Ele não vê o menu Financeiro, a rota responde 404 e a RLS devolve zero linhas; o vendedor não vê % nem comissão. Testes nas Tasks 3, 10, 15 e 16.
5. **Projeção sem nenhum saldo informado.** A tela pede o saldo em vez de mostrar R$ 0 como se fosse real. A função de cálculo devolve `null`. Testes nas Tasks 9 e 11.

---

### Task 1: Categorias de serviço no banco

**Files:**
- Create: `supabase/migrations/20261030000001_service_categories.sql`
- Test: `supabase/tests/43_service_categories.test.sql`

**Interfaces:**
- Produces:
  - tabela `service_categories(id, company_id, name, color text default '#64748b', position int, active bool default true)`, com `unique(company_id, lower(name))`;
  - colunas `products.service_category_id`, `deals.service_category_id` e `deal_items.service_category_id` (todas `uuid null references service_categories on delete restrict`);
  - função `seed_service_categories(p_company uuid) returns void`, que insere as 6 categorias da seção Global Constraints se a empresa ainda não tem nenhuma.

- [ ] **Step 1: Write the failing test**
  `43_service_categories.test.sql`, com fixtures de empresas, usuários e papéis copiadas de `13_deals_functions.test.sql`, deve provar:
  - um membro da empresa lê as categorias dela e não lê as de outra empresa;
  - quem não é admin não insere nem atualiza (`throws_ok` ou 0 linhas afetadas);
  - o admin geral insere;
  - nome duplicado ignorando maiúsculas falha com `23505`;
  - `seed_service_categories` cria exatamente 6 linhas e, na segunda chamada, continua com 6;
  - um `deal_items` novo com produto cuja categoria é X recebe `service_category_id = X` quando o insert não informa a categoria;
  - `guard_same_company` rejeita uma categoria de outra empresa em `deals.service_category_id`;
  - excluir uma categoria usada por um produto falha com `23503`.
- [ ] **Step 2: Run it to verify it fails**
  Run: `pnpm test:db 43_` → Expected: FAIL (relation `service_categories` não existe).
- [ ] **Step 3: Write the migration**
  - Tabela, índices, RLS (`select` para quem é membro ou admin geral; escrita só para o admin geral) e as colunas novas.
  - Trigger `before insert on deal_items` que copia `products.service_category_id` quando `new.service_category_id is null`.
  - Estenda `guard_same_company` para a nova FK, seguindo o padrão das FKs existentes.
  - Função de seed `security definer`, com `execute` revogado de `public` e concedido a `authenticated` só por meio da checagem `is_super_admin()` dentro da função.
- [ ] **Step 4: Apply and test**
  Run: `pnpm db:migrate && pnpm test:db 43_` → Expected: PASS. Run `pnpm test:db` completo → nenhum teste anterior quebrado.
- [ ] **Step 5: Commit** `feat(crm): categorias de serviço em produtos, negócios e itens`

### Task 2: Categorias de serviço na interface

**Files:**
- Create: `src/lib/service-categories/schema.ts`, `src/lib/service-categories/schema.test.ts`, `src/lib/service-categories/actions.ts`, `src/app/(app)/configuracoes/categorias-servico/page.tsx`, `src/components/settings/service-categories-manager.tsx`, `src/components/records/service-category-select.tsx`, `e2e/service-categories.spec.ts`
- Modify: o menu lateral de Configurações (em `src/app/(app)/configuracoes/layout.tsx`); `src/components/settings/products-manager.tsx` e `src/lib/products/{schema,actions}.ts` (campo categoria); o detalhe do negócio e o editor de itens em `src/components/deals/` (campo categoria no negócio e em cada item); `src/lib/deals/{schema,actions}.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `serviceCategorySchema = z.object({ name: string 1..80 trim, color: /^#[0-9a-f]{6}$/i opcional })`;
  - ações `createServiceCategory(companyId, input): ActionResult<{id}>`, `updateServiceCategory(id, input)`, `setServiceCategoryActive(id, active)`, `reorderServiceCategories(companyId, ids: string[])`;
  - componente `<ServiceCategorySelect companyId value onChange allowCreate />`. Ele mostra só as ativas e oferece "Nova categoria…" quando `allowCreate`, que é verdadeiro só para o admin geral.

- [ ] **Step 1: Failing Vitest** `schema.test.ts`: aceita `{name:"Serviço SEO/GEO"}`; rejeita nome vazio com "Informe o nome da categoria."; rejeita cor `"red"`.
- [ ] **Step 2:** `pnpm test src/lib/service-categories` → FAIL.
- [ ] **Step 3: Implement**
  - Escreva o schema e as actions como `src/lib/products/actions.ts`, com `PATH = "/configuracoes/categorias-servico"` e erro `23505` → "Já existe uma categoria com esse nome.".
  - Escreva a página e o manager: criação em uma linha (input + Enter), reordenação por arrastar com `@dnd-kit/sortable` como em funis, cor e o interruptor de ativo.
  - Ligue o select nos produtos, no negócio (visível só quando o negócio não tem itens) e nos itens.
- [ ] **Step 4:** `pnpm test src/lib/service-categories` → PASS.
- [ ] **Step 5: E2E** em `e2e/service-categories.spec.ts`:
  - o admin cria "Serviço SEO/GEO" em Configurações › Categorias de serviço;
  - define essa categoria num produto;
  - adiciona o produto a um negócio e vê a categoria no item;
  - criar o mesmo nome de novo mostra "Já existe uma categoria com esse nome.".

  Run: `pnpm test:e2e e2e/service-categories.spec.ts` → PASS.
- [ ] **Step 6:** `pnpm typecheck && pnpm lint` → limpos. **Commit** `feat(crm): cadastro e seleção de categorias de serviço`

### Task 3: Permissões e ativação do Financeiro por empresa

**Files:**
- Create: `supabase/migrations/20261030000002_finance_access.sql`, `supabase/tests/44_finance_access.test.sql`, `src/lib/finance/permissions.ts`
- Modify: `src/lib/permissions/schema.ts`, `src/lib/permissions/schema.test.ts`, `src/lib/permissions/labels.ts`, a tela de papéis (`src/app/(app)/configuracoes/papeis/[id]` e o componente dela), a tela de empresas (`src/app/(app)/configuracoes/empresas` e `src/lib/companies/{schema,actions}.ts`)

**Interfaces:**
- Produces:
  - `companies.finance_enabled boolean not null default false`;
  - chaves `settings.view_finance`, `settings.manage_finance` e `settings.register_sales`, **opcionais** em `is_valid_permissions`. O conjunto de chaves de `settings` passa a ser as 6 atuais mais qualquer subconjunto das 3 novas. Assim, os fixtures dos testes pgTAP existentes continuam válidos;
  - `public.can_finance(p_company uuid, p_action text) returns boolean` (`stable`, `security definer`), com `p_action` em `'view'`, `'manage'` ou `'sell'`:
    - falso se `finance_enabled` é falso;
    - verdadeiro para o admin geral;
    - `view` = `view_finance` ou `manage_finance` no papel do usuário na empresa;
    - `manage` = `manage_finance`;
    - `sell` = `register_sales` ou `manage_finance`. `sell` **não** dá `view`;
  - TS: `SETTINGS` inclui `"view_finance"`, `"manage_finance"` e `"register_sales"`; no `permissionsSchema` essas três chaves são `z.boolean().optional()`; `DEFAULT_PERMISSIONS` traz as três como `false`; labels "Ver financeiro", "Gerenciar financeiro" e "Cadastrar vendas de clientes";
  - `src/lib/finance/permissions.ts` (`server-only`):
    - `getFinanceAccess(companyId): Promise<{ view: boolean; manage: boolean; sell: boolean }>`;
    - `salesCompanySlugs(): Promise<string[]>`, as empresas em que `can_finance(...,'sell')` é verdadeiro;
    - `financeCompanySlugs(): Promise<string[]>`, as empresas acessíveis em que `can_finance(...,'view')` é verdadeiro;
  - trigger: quando `finance_enabled` passa de falso para verdadeiro, chama `fin_seed_categories(company)`. Na Task 4 ela é criada com `create or replace`, e nesta migration fica um stub vazio para manter a ordem.

- [ ] **Step 1: Failing pgTAP** `44_finance_access.test.sql`:
  - um papel com as 6 chaves antigas continua válido;
  - um papel com `view_finance:true` é válido;
  - uma chave desconhecida `foo` é inválida;
  - `can_finance` devolve `false` com `finance_enabled=false`, mesmo para o admin geral;
  - com `finance_enabled=true`: o admin geral tem `true`; o papel sem as chaves tem `false`; `view_finance` dá `view=true` e `manage=false`; `manage_finance` dá `view=true` e `manage=true`; `register_sales` dá `sell=true`, `view=false` e `manage=false`; um não membro tem `false`;
  - um não admin não consegue fazer `update companies set finance_enabled`.
- [ ] **Step 2:** `pnpm test:db 44_` → FAIL.
- [ ] **Step 3: Implement** a migration (`create or replace function is_valid_permissions`, coluna, função, stub e trigger).
- [ ] **Step 4:** `pnpm db:migrate && pnpm test:db` → tudo PASS.
- [ ] **Step 5: Failing Vitest** em `schema.test.ts`: um papel sem as chaves de finanças passa; `{...DEFAULT_PERMISSIONS.settings, view_finance: true}` passa; `DEFAULT_PERMISSIONS.settings.manage_finance === false`.
- [ ] **Step 6:** Implemente o TS, os interruptores na tela de papéis e o interruptor "Financeiro ativo" na tela de empresas (só para o admin geral). Run: `pnpm test src/lib/permissions && pnpm typecheck` → PASS.
- [ ] **Step 7: Commit** `feat(financeiro): permissões e ativação por empresa`

### Task 4: Base do Financeiro (contas, saldo, categorias)

**Files:**
- Create: `supabase/migrations/20261030000003_finance_base.sql`, `supabase/tests/45_finance_base.test.sql`

**Interfaces:**
- Consumes: `can_finance` (Task 3).
- Produces:
  - `fin_accounts(id, company_id, name, bank text null, active)`, com `unique(company_id, lower(name))`;
  - `fin_balance_snapshots(id, company_id, account_id, as_of date, balance numeric(14,2), note)`, com `unique(account_id, as_of)`;
  - `fin_expense_categories(id, company_id, name, default_nature text check in ('fixed','variable','non_recurring'), position, active)`;
  - `fin_income_categories(id, company_id, name, position, active)`;
  - `fin_seed_categories(p_company uuid)`, que insere os seeds de despesa e de receita da seção Global Constraints e também chama `seed_service_categories`. Ela é idempotente;
  - política RLS padrão do Financeiro, usada em todas as tabelas `fin_*` desta e das próximas tasks: `select using (can_finance(company_id,'view'))`; insert, update e delete `using/with check (can_finance(company_id,'manage'))`.

- [ ] **Step 1: Failing pgTAP**:
  - ligar `finance_enabled` cria 12 categorias de despesa, 4 de receita e 6 de serviço; religar não duplica;
  - Pró-labore tem `default_nature = 'fixed'`;
  - um usuário com `view_finance` lê e não insere uma conta;
  - um usuário com `manage_finance` insere uma conta e um saldo;
  - um usuário sem as chaves lê 0 linhas;
  - um saldo com conta de outra empresa é rejeitado (`guard_same_company`);
  - dois saldos na mesma conta e data falham com `23505`.
- [ ] **Step 2:** `pnpm test:db 45_` → FAIL.
- [ ] **Step 3: Implement** a migration.
- [ ] **Step 4:** `pnpm db:migrate && pnpm test:db 45_` → PASS.
- [ ] **Step 5: Commit** `feat(financeiro): contas, saldo informado e categorias`

### Task 5: Contratos e geração de lançamentos

**Files:**
- Create: `supabase/migrations/20261030000004_finance_contracts.sql`, `supabase/tests/46_finance_contracts.test.sql`

**Interfaces:**
- Consumes: Tasks 1, 3 e 4.
- Produces:
  - `fin_contracts`:
    - `id, company_id, organization_id null, deal_id uuid null unique references deals on delete set null, title`;
    - `status text check in ('draft','active','ended','cancelled') default 'draft'`;
    - `due_day int null check 1..31`;
    - `retention_rate numeric(5,2) not null default 0 check 0..100`;
    - `account_id null`;
    - `end_rule text null check in ('ends','auto_renew','renew_adjust','confirm')`;
    - `renewal_months int null check 1..120`;
    - `adjust_kind text not null default 'none' check in ('none','percent','index')`;
    - `adjust_index text null check in ('IPCA','IGP-M','INPC')`;
    - `adjust_rate numeric(6,3) not null default 0`;
    - `source_changed bool not null default false`, `notes`;
  - `fin_contract_lines`:
    - `id, contract_id, company_id, kind check in ('setup','recurring','commission'), description, service_category_id null`;
    - comissão: `setup_rate numeric(6,3) null`, `recurring_rate numeric(6,3) null`, `estimated_monthly numeric(14,2) null`; para `commission`, `amount` é nulo, `months` é obrigatório e pelo menos um dos dois % é preenchido (check);
    - `amount numeric(14,2) null check > 0`, obrigatório em setup e recurring; `first_month date (dia 1)`;
    - `installments int not null default 1 check 1..60` (setup);
    - `months int null check 1..120`, obrigatório quando `kind='recurring'`;
  - `fin_entries`:
    - `id, company_id, direction check in ('in','out')`;
    - `source_kind check in ('contract','recurring','sale','manual','import')`;
    - `contract_id, contract_line_id, recurring_expense_id (FK adicionada na Task 6), source_key text null`;
    - `due_date date, competence date (dia 1)`;
    - `gross numeric(14,2) >= 0`, `retention numeric(14,2) default 0`, `amount numeric(14,2) generated always as (gross - retention) stored`;
    - `status check in ('open','settled','cancelled') default 'open'`, `settled_on date null`, `settled_amount numeric(14,2) null`;
    - `account_id, organization_id, service_category_id, income_category_id, expense_category_id`;
    - `nature null check in ('fixed','variable','non_recurring')`, `description`;
    - `locked bool default false`, `is_renewal bool default false`, `renewal_pending bool default false`, `estimated bool default false`;
    - índices únicos parciais: `(contract_line_id, competence) where contract_line_id is not null` e `(company_id, source_key) where source_key is not null`;
    - checks: liquidado ⇒ `settled_on` e `settled_amount` preenchidos; `direction='out'` ⇒ `nature` não nula;
  - `fin_due_date(p_month date, p_day int) returns date`: `make_date(ano, mês, least(p_day, último dia do mês))`;
  - `fin_horizon_end() returns date`: `date_trunc('month', current_date) + interval '36 months'`, exclusivo;
  - `fin_regenerate_contract(p_contract uuid) returns void` (`security definer`, chamada só por triggers e funções que já validaram `manage`).

**Algoritmo de `fin_regenerate_contract`** (o implementador não deduz isto sozinho):
```
só mexe em entries com source_kind='contract' (as de vendas, source_kind='sale', são da Task 15)
se status <> 'active': apaga as entries open e não locked do contrato; retorna
apaga as entries do contrato com status='open' e locked=false
para cada linha L:
  se L.kind='setup': para i em 0..installments-1:
     gross = trunc(amount/installments, 2), e a última parcela leva o resíduo (amount - soma das anteriores)
     competência = first_month + i meses
  se L.kind='recurring':
     ciclo 0: months meses a partir de first_month, valor = amount, is_renewal=false
     depois, enquanto a competência < fin_horizon_end() e end_rule <> 'ends':
        ciclo k: coalesce(renewal_months, L.months) meses
        valor = amount * (1 + adjust_rate/100)^k (arredondado a 2 casas) se end_rule='renew_adjust', senão amount
        is_renewal=true, renewal_pending = (end_rule='confirm')
     a competência nunca passa de fin_horizon_end()
  se L.kind='commission': só gera algo se estimated_monthly não é nulo:
     mesmas competências e ciclos de renovação da recorrente (sem reajuste), gross = estimated_monthly,
     estimated=true (e renewal_pending nos ciclos de 'confirm')
  para cada competência gerada sem entry existente (liquidada ou locked) na mesma (L.id, competence):
     insere a entry: direction='in', due_date=fin_due_date(competence, due_day),
     retention = round(gross*retention_rate/100, 2), service_category_id=L.service_category_id,
     organization_id e account_id do contrato, description = título do contrato || ' – ' || L.description
```
Triggers: `after insert/update/delete` em `fin_contract_lines` e `after update` em `fin_contracts` chamam a regeneração.

- [ ] **Step 1: Failing pgTAP** `46_finance_contracts.test.sql`, com um contrato ativo, `due_day = 31` e `retention_rate = 10`:
  - recorrente de 1.000 por 3 meses a partir de 2026-01-01, `end_rule='ends'`: 3 entries com `due_date` 2026-01-31, 2026-02-28 e 2026-03-31; `retention = 100`; `amount = 900`;
  - setup de 1.000,00 em 3 parcelas: 333,33 / 333,33 / 333,34;
  - `auto_renew` de 12 meses a partir do mês corrente: entries até o mês anterior a `fin_horizon_end()`, as dos meses 13+ com `is_renewal=true` e `renewal_pending=false`;
  - `confirm`: as renovações têm `renewal_pending=true`;
  - `renew_adjust` com 10% e `renewal_months=12`: o mês 13 vale 1.100,00 e o mês 25 vale 1.210,00;
  - liquidar a entry de fevereiro, mudar o `amount` da linha para 2.000 e conferir que fevereiro mantém o valor antigo, que março passa a 2.000 e que existe só uma entry de fevereiro;
  - uma entry `locked` também sobrevive à regeneração;
  - contrato `draft`: 0 entries;
  - linha `commission` com `estimated_monthly = 2.000` por 3 meses: 3 entries `estimated=true` de 2.000; sem `estimated_monthly`: 0 entries;
  - linha `commission` sem `setup_rate` e sem `recurring_rate` falha no check;
  - `recurring` sem `months` falha no check.
- [ ] **Step 2:** `pnpm test:db 46_` → FAIL.
- [ ] **Step 3: Implement** a migration.
- [ ] **Step 4:** `pnpm db:migrate && pnpm test:db 46_` → PASS.
- [ ] **Step 5: Commit** `feat(financeiro): contratos com vigência e geração de parcelas`

### Task 6: Despesas recorrentes e extensão do horizonte

**Files:**
- Create: `supabase/migrations/20261030000005_finance_recurring.sql`, `supabase/tests/47_finance_recurring.test.sql`

**Interfaces:**
- Consumes: Task 5 (`fin_entries`, `fin_due_date`, `fin_horizon_end`).
- Produces:
  - `fin_recurring_expenses`:
    - `id, company_id, description, payee null, expense_category_id not null`;
    - `nature not null check in ('fixed','variable','non_recurring')`;
    - `amount numeric(14,2) > 0`;
    - `frequency check in ('monthly','quarterly','yearly') default 'monthly'`;
    - `due_day 1..31`, `start_month date (dia 1)`, `end_month date null`;
    - `installments int null check 1..360`;
    - `adjust_rate numeric(6,3) default 0`, `adjust_month int null check 1..12`;
    - `account_id null`, `active bool default true`;
  - FK `fin_entries.recurring_expense_id` e índice único parcial `(recurring_expense_id, competence)`;
  - `fin_regenerate_recurring(p_expense uuid)`:
    - ocorrências a cada 1, 3 ou 12 meses a partir de `start_month`;
    - para no menor entre `end_month` (inclusive), `installments` ocorrências e `fin_horizon_end()`;
    - valor = `amount * (1+adjust_rate/100)^n`, em que `n` conta as vezes que `adjust_month` foi alcançado depois de `start_month`, sem contar o próprio `start_month`;
    - as entries são `direction='out'`, com a natureza e a categoria da despesa e `description = description || ' (i/N)'` quando há `installments`;
    - mesma preservação de liquidadas e `locked` da Task 5;
    - despesa inativa: apaga as open não locked;
  - `fin_extend_horizon()`: regenera todos os contratos ativos e as despesas ativas e marca como `ended` os contratos com `end_rule='ends'` cuja última competência é anterior ao mês corrente. Ela é agendada no pg_cron como `'fin-extend-horizon'`, `'0 6 1 * *'`, seguindo o padrão de agendamento de `generate_activity_reminders`.

- [ ] **Step 1: Failing pgTAP**:
  - mensal de 500 com `installments = 10` a partir de 2026-10-01: 10 entries, a última em 2026-07 de 2027 com descrição terminando em "(10/10)";
  - trimestral sem fim: competências de 3 em 3 meses até o horizonte;
  - `end_month = 2026-12-01`: a última competência é dezembro;
  - reajuste de 5% com `adjust_month = 1`, a partir de 2026-10: out–dez/2026 valem 500, jan/2027 vale 525 e jan/2028 vale 551,25;
  - liquidada mais edição: preservada e sem duplicar;
  - inativar apaga as abertas futuras;
  - `fin_extend_horizon` marca como `ended` um contrato `ends` encerrado.
- [ ] **Step 2:** `pnpm test:db 47_` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4:** `pnpm db:migrate && pnpm test:db 47_` → PASS.
- [ ] **Step 5: Commit** `feat(financeiro): despesas recorrentes e horizonte de 36 meses`

### Task 7: Negócio ganho vira contrato rascunho; ativação

**Files:**
- Create: `supabase/migrations/20261030000006_finance_deal_bridge.sql`, `supabase/tests/48_finance_deal_bridge.test.sql`

**Interfaces:**
- Consumes: `deals`, `deal_items` e as condições de contrato (`20261023000001_deals_schema.sql`); Tasks 1 e 5.
- Produces:
  - `fin_draft_from_deal(p_deal uuid)` (`security definer`, interna). Ela cria ou reconstrói o contrato rascunho:
    - `title` = título do negócio, `organization_id` = organização do negócio;
    - linhas a partir dos `deal_items`: o valor é o total do item, calculado com a mesma fórmula de `deal_items_recalc`; setup usa `setup_first_due` e `setup_installments`; recorrente usa `mrr_start` e `contract_months`; a categoria vem do item;
    - sem itens: uma linha setup (`setup_total`) e/ou uma recorrente (`mrr`), com `deals.service_category_id`;
  - trigger em `deals` (`after update of status` e das colunas de contrato), só quando `companies.finance_enabled`:
    - passa a `won` → `fin_draft_from_deal`;
    - continua `won`, a condição muda e o contrato é `draft` → reconstrói as linhas;
    - sai de `won` e o contrato é `draft` → apaga o contrato;
    - contrato `active` e qualquer mudança acima → `source_changed = true`, sem mexer nas linhas;
  - trigger em `deal_items` com a mesma regra para o rascunho;
  - `fin_activate_contract(p_contract uuid) returns void`:
    - exige `can_finance(company,'manage')`, senão `42501`;
    - valida `organization_id`, `due_day`, `account_id`, `end_rule`, pelo menos uma linha e todas as linhas com `service_category_id`;
    - na falha, levanta `P0001`, mensagem "Faltam dados para ativar o contrato" e `detail` com os rótulos que faltam separados por vírgula, na ordem: Cliente, Dia de vencimento, Conta, Regra de fim de vigência, Linhas, Categoria de serviço (no padrão de `deals_required_fields`);
    - se tudo está certo, faz `status='active'`, o que dispara a regeneração.

- [ ] **Step 1: Failing pgTAP**:
  - empresa com Financeiro desligado: ganhar o negócio não cria contrato;
  - ligado: um negócio com MRR de 5.000, início 2026-11-01, 12 meses e setup de 3.000 em 3x → contrato `draft` com 2 linhas e valores corretos, criado mesmo quando quem ganha é um usuário sem `view_finance`;
  - um negócio com 2 itens → 2 linhas com as categorias dos itens;
  - mudar o MRR do negócio ganho com o contrato em `draft` → a linha é atualizada;
  - reabrir o negócio com o contrato em `draft` → o contrato some;
  - com o contrato ativo e o negócio reaberto → o contrato continua, `source_changed = true` e as entries continuam;
  - `fin_activate_contract` sem dia e sem conta falha com `detail = 'Dia de vencimento, Conta, Regra de fim de vigência'`;
  - a ativação completa gera entries;
  - um usuário só com `view_finance` recebe `42501`.
- [ ] **Step 2:** `pnpm test:db 48_` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4:** `pnpm db:migrate && pnpm test:db` → tudo PASS (confirme que `13_deals_functions` continua verde).
- [ ] **Step 5: Commit** `feat(financeiro): negócio ganho gera contrato rascunho`

### Task 8: Baixa e operações de lançamento

**Files:**
- Create: `supabase/migrations/20261030000007_finance_entry_ops.sql`, `supabase/tests/49_finance_entry_ops.test.sql`, `src/lib/finance/schema.ts`, `src/lib/finance/schema.test.ts`, `src/lib/finance/entries-actions.ts`

**Interfaces:**
- Consumes: Tasks 5 e 6.
- Produces (SQL, todas exigem `can_finance(...,'manage')`):
  - `fin_settle_entries(p_ids uuid[], p_settled_on date, p_account uuid default null, p_amount numeric default null) returns int`:
    - liquida as entries `open`;
    - `settled_amount = coalesce(p_amount, amount)`, mas `p_amount` só é aceito quando `array_length(p_ids,1)=1`;
    - `account_id = coalesce(p_account, account_id)`;
    - devolve quantas mudou;
  - `fin_reopen_entry(p_id uuid)`: volta para `open` e limpa a liquidação;
  - trigger `before update` em `fin_entries`: se o usuário muda `gross`, `retention`, `due_date` ou `description` de uma entry `contract` ou `recurring`, faz `locked = true`.
- Produces (TS):
  - `entryInputSchema`, para o lançamento avulso: `{ direction, dueDate (ISO), gross (parseBRL como products), description 1..200, accountId?, organizationId?, incomeCategoryId?, serviceCategoryId?, expenseCategoryId?, nature? }`. Saída exige `expenseCategoryId` e `nature`; entrada exige `incomeCategoryId` ou `serviceCategoryId`;
  - `settleSchema`: `{ ids: uuid[] (1..500), settledOn, accountId?, amount? }`;
  - ações em `entries-actions.ts`:
    - `createManualEntry(companyId, input): ActionResult<{id}>`;
    - `updateEntry(id, input)`;
    - `cancelEntry(id)`;
    - `settleEntries(input): ActionResult<{count}>`;
    - `reopenEntry(id)`;
    - todas fazem `revalidatePath('/[empresa]/financeiro', 'layout')`.

- [ ] **Step 1: Failing pgTAP**:
  - liquidar 2 ids → devolve 2, ambas `settled` com `settled_amount = amount`;
  - liquidar 2 ids com `p_amount` → erro;
  - liquidar 1 id com `p_amount = 950` → 950;
  - editar o `gross` de uma entry de contrato → `locked = true`;
  - `fin_reopen_entry` limpa `settled_on`;
  - usuário com `view_finance` → `42501`.
- [ ] **Step 2: Failing Vitest** `schema.test.ts`:
  - uma saída sem `expenseCategoryId` falha com "Escolha a categoria da despesa.";
  - `gross: "1.234,56"` vira 1234.56;
  - `ids` vazio falha.
- [ ] **Step 3:** `pnpm test:db 49_ ; pnpm test src/lib/finance` → FAIL.
- [ ] **Step 4: Implement** a migration, o schema e as actions.
- [ ] **Step 5:** os mesmos comandos → PASS.
- [ ] **Step 6: Commit** `feat(financeiro): baixa, reabertura e lançamentos avulsos`

### Task 9: Cálculos puros (saldo, projeção, share, custos)

**Files:**
- Create: `src/lib/finance/calc.ts`, `src/lib/finance/calc.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type EntryLite = { id: string; direction: "in" | "out"; status: "open" | "settled" | "cancelled";
    dueDate: string; settledOn: string | null; competence: string; gross: number; retention: number;
    amount: number; settledAmount: number | null; accountId: string | null; organizationId: string | null;
    serviceCategoryId: string | null; expenseCategoryId: string | null; nature: "fixed" | "variable" | "non_recurring" | null };
  type Snapshot = { accountId: string; asOf: string; balance: number };
  function balanceSeries(snapshots: Snapshot[], entries: EntryLite[], from: string, to: string, today: string): { date: string; balance: number }[] | null;
  function monthlyProjection(entries: EntryLite[], months: string[], today: string): MonthRow[];
  type MonthRow = { month: string; grossIn: number; retention: number; netIn: number; fixed: number; variable: number; nonRecurring: number; result: number; realized: boolean };
  function shareBy(entries: EntryLite[], key: "organizationId" | "serviceCategoryId" | "expenseCategoryId"): { key: string | null; amount: number; share: number }[];
  function breakEven(fixed: number, variable: number, revenue: number): number | null;
  function coverageMonths(balance: number, avgMonthlyFixed: number): number | null;
  ```
- Regras:
  - `balanceSeries`: devolve `null` sem nenhum snapshot. Por conta, parte do último snapshot com `asOf <= from`, ou do primeiro depois. Liquidadas contam em `settledOn > asOf` com `settledAmount`. Abertas contam em `max(dueDate, today)` com `amount`. Saídas subtraem. Canceladas são ignoradas.
  - `monthlyProjection`: meses anteriores a `today` usam só as liquidadas (`realized: true`); o mês corrente e os futuros usam liquidadas mais abertas.
  - `shareBy`: soma `amount` (liquidado ou aberto), ordena de forma decrescente e a soma dos `share` é 1.
  - `breakEven`: devolve `fixed / (1 - variable/revenue)`, ou `null` se `revenue <= 0` ou `variable >= revenue`.
  - `coverageMonths`: devolve `null` se `avgMonthlyFixed <= 0`.

- [ ] **Step 1: Failing tests**:
  - `balanceSeries([], …)` → `null`;
  - snapshot de 10.000 em 2026-10-26, uma entrada aberta de 5.000 em 2026-10-28 e uma saída liquidada de 2.000 em 2026-10-27, com `today` 2026-10-29: em 2026-10-27 o saldo é 8.000; em 2026-10-29 é 13.000 (a entrada vencida conta hoje);
  - uma saída liquidada em 2026-10-25 (antes do snapshot) é ignorada;
  - `breakEven(50000, 10000, 100000)` → 55555.56 com 2 casas;
  - `breakEven(1, 5, 5)` → `null`;
  - `coverageMonths(120000, 60000)` → 2;
  - `shareBy` com 3 clientes de 60/30/10 → shares 0.6/0.3/0.1, na ordem;
  - `monthlyProjection`: setembro realizado ignora abertas, novembro soma abertas, e `result = netIn - fixed - variable - nonRecurring`.
- [ ] **Step 2:** `pnpm test src/lib/finance/calc` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(financeiro): cálculos de saldo, projeção e custos`

### Task 10: Casca do módulo (menu, rota, filtros, consultas)

**Files:**
- Create: `src/lib/finance/filters.ts`, `src/lib/finance/filters.test.ts`, `src/lib/finance/queries.ts`, `src/app/(app)/[empresa]/financeiro/layout.tsx`, `src/components/finance/finance-tabs.tsx`, `src/components/finance/finance-filters.tsx`, `e2e/finance-access.spec.ts`
- Modify: `src/lib/nav.ts` e `src/lib/nav.test.ts`, `src/components/shell/app-shell.tsx`

**Interfaces:**
- Consumes: Tasks 3, 8 e 9.
- Produces:
  - `FinanceFilters = { from: string; to: string; clients: string[]; serviceCategories: string[]; expenseCategories: string[]; natures: Nature[]; accounts: string[]; statuses: Status[]; includePendingRenewals: boolean; includeEstimatedCommissions: boolean; horizon: 3|6|12|24|36 }`;
  - `parseFinanceFilters(sp: Record<string,string|string[]|undefined>, today: string): FinanceFilters`, com os padrões: `from` = 1º dia do mês corrente, `to` = último dia, `horizon` = 12, `includePendingRenewals` = false, `includeEstimatedCommissions` = false e listas vazias (= sem filtro, como em "Semântica dos filtros" do README);
  - `toFinanceSearchParams(f): URLSearchParams`, que omite os padrões;
  - `queries.ts` (`server-only`):
    - `listEntries(companyId, f): Promise<EntryLite[]>`, com `renewal_pending=false` quando `!includePendingRenewals`, `estimated=false` quando `!includeEstimatedCommissions` e sem canceladas por padrão;
    - `listSnapshots(companyId): Promise<Snapshot[]>`;
    - `listFinanceLookups(companyId)`, que devolve contas, categorias e organizações com contrato;
  - nav: item `{ key: "financeiro", label: "Financeiro", icon: Wallet, path: "/financeiro", availableFromPhase: 8, scoped: true }`, com `8` em `DELIVERED_PHASES`. `isNavItemEnabled` recebe `canViewFinance` no objeto de acesso, e o item só aparece com o escopo de uma empresa (nunca em "todas") que esteja em `financeCompanySlugs()`;
  - layout: resolve o escopo; com escopo "todas" ou `!getFinanceAccess(...).view` → `notFound()`. Renderiza as abas Mês · Projeção · Clientes · Serviços · Custos · Lançamentos · Contratos · Despesas · Vendas · Configurações (a aba Vendas é criada na Task 16). Configurações só aparece com `manage`.

- [ ] **Step 1: Failing Vitest**:
  - `parseFinanceFilters({}, "2026-10-29")` → from 2026-10-01, to 2026-10-31, horizon 12;
  - `horizon=7` volta a 12;
  - ida e volta por `toFinanceSearchParams` preserva `clients=["a","b"]`;
  - nav: o item Financeiro aparece com `canViewFinance` e não aparece sem ele.
- [ ] **Step 2:** `pnpm test src/lib/finance/filters src/lib/nav` → FAIL.
- [ ] **Step 3: Implement**. A barra de filtros é um client component que escreve na URL com `router.replace`, sem recarregar a página toda.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: E2E** `finance-access.spec.ts`:
  - um usuário sem `view_finance` não vê "Financeiro" no menu e recebe 404 em `/<empresa>/financeiro`;
  - o admin com a empresa ativada vê as abas;
  - com a empresa desativada, nem o admin vê o menu.

  Run: `pnpm test:e2e e2e/finance-access.spec.ts` → PASS.
- [ ] **Step 6: Commit** `feat(financeiro): menu, rota protegida e filtros`

### Task 11: Visões Mês e Lançamentos

**Files:**
- Create: `src/app/(app)/[empresa]/financeiro/page.tsx` (Mês), `src/app/(app)/[empresa]/financeiro/lancamentos/page.tsx`, `src/app/(app)/[empresa]/financeiro/lancamentos/export/route.ts`, `src/components/finance/month-view.tsx`, `src/components/finance/entries-table.tsx`, `src/components/finance/settle-dialog.tsx`, `src/components/finance/entry-dialog.tsx`, `src/components/finance/balance-missing.tsx`, `src/lib/finance/export.ts`, `src/lib/finance/export.test.ts`, `e2e/finance-month.spec.ts`

**Interfaces:**
- Consumes: Tasks 8, 9 e 10.
- Produces: `entriesToCsv(entries, lookups): string`, com cabeçalho `Vencimento;Tipo;Descrição;Cliente;Categoria;Natureza;Valor bruto;Retenção;Valor;Status;Liquidado em;Valor liquidado`, separador `;`, decimal com vírgula e BOM UTF-8, como `src/lib/deals/export.ts`.
- Tela Mês:
  - 4 cards: Saldo atual, A receber, A pagar e Saldo projetado no fim do mês;
  - lista agrupada por dia com o saldo corrido, vencidas não liquidadas em vermelho, caixa de seleção e "Liquidar selecionados", navegação ‹ mês ›;
  - sem snapshot, `<BalanceMissing>` substitui os cards e a lista de saldo com "Informe o saldo de pelo menos uma conta para ver a projeção." e um botão para Configurações › Contas (ou o texto "Peça a quem gerencia o financeiro." sem `manage`).
- Lançamentos: tabela paginada (50 por página) com todos os filtros, "Novo lançamento" e "Exportar CSV".

- [ ] **Step 1: Failing Vitest** `export.test.ts`: uma linha com gross 1234.5 vira `1234,50`; a primeira linha é o cabeçalho exato; ponto e vírgula dentro da descrição vai entre aspas.
- [ ] **Step 2:** `pnpm test src/lib/finance/export` → FAIL → implement → PASS.
- [ ] **Step 3: Implement** as páginas e os componentes.
- [ ] **Step 4: E2E** `finance-month.spec.ts`:
  - sem saldo, aparece o aviso;
  - informar um saldo de 10.000 e criar um lançamento avulso de saída de 2.000 vencendo hoje → o saldo projetado no fim do mês é R$ 8.000,00;
  - selecionar e liquidar → o status vira "Liquidado";
  - exportar CSV baixa um arquivo com o cabeçalho.

  Run: `pnpm test:e2e e2e/finance-month.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(financeiro): visão do mês, lançamentos e baixa em lote`

### Task 12: Contratos, despesas recorrentes e configurações do Financeiro

**Files:**
- Create: `src/lib/finance/contracts-actions.ts`, `src/lib/finance/expenses-actions.ts`, `src/lib/finance/settings-actions.ts`; schemas novos em `src/lib/finance/schema.ts` (com testes em `schema.test.ts`); páginas `financeiro/contratos/page.tsx`, `financeiro/contratos/[id]/page.tsx`, `financeiro/despesas/page.tsx`, `financeiro/configuracoes/page.tsx`; componentes `src/components/finance/{contract-form,contract-lines-editor,expense-form,accounts-manager,categories-manager}.tsx`; `e2e/finance-contracts.spec.ts`

**Interfaces:**
- Consumes: Tasks 4–8.
- Produces:
  - `contractSchema`: `{ title, organizationId?, dueDay 1..31?, retentionRate 0..100, accountId?, endRule?, renewalMonths?, adjustKind, adjustIndex?, adjustRate, notes? }`, com o refine "Informe o índice." quando `adjustKind='index'` sem índice;
  - `contractLineSchema`: `{ kind, description, serviceCategoryId?, amount>0 (setup e recurring), firstMonth (YYYY-MM), installments 1..60, months 1..120 obrigatório se recurring ou commission, setupRate? 0..100, recurringRate? 0..100, estimatedMonthly? }`. Para `commission`: "Informe ao menos um percentual." sem nenhum %. O editor de linhas mostra os campos de % e de estimativa só para o tipo Comissão;
  - `recurringExpenseSchema`, espelhando as colunas da Task 6;
  - ações:
    - `createContract`, `updateContract`, `saveContractLines(contractId, lines[])` (substitui o conjunto todo), `activateContract(id)` (chama `fin_activate_contract` e traduz o `detail` para "Faltam: …"), `cancelContract(id)`, `acknowledgeSourceChange(id)` (zera `source_changed`);
    - `createRecurringExpense`, `updateRecurringExpense`, `setRecurringExpenseActive`;
    - `createAccount`, `updateAccount`, `setAccountActive`, `saveBalanceSnapshot(accountId, asOf, balance, note?)`;
    - CRUD em uma linha das categorias de despesa e de receita, com o mesmo padrão da Task 2.
- Telas:
  - Contratos: abas Pendentes (com contagem no rótulo da aba), Ativos e Encerrados;
  - detalhe do contrato com o formulário, o editor de linhas, a regra de fim, o aviso "O negócio de origem mudou" com link para o negócio e "Ciente", e a lista dos lançamentos do contrato;
  - Despesas: lista e formulário;
  - Configurações: Contas (com "Informar saldo"), Categorias de despesa e Categorias de receita;
  - os selects de categoria nos formulários oferecem "Nova categoria…" para quem tem `manage`.

- [ ] **Step 1: Failing Vitest**: uma linha `recurring` sem `months` falha com "Informe a duração em meses."; `adjustKind='index'` sem índice falha com "Informe o índice."; `firstMonth: "2026-11"` vira `"2026-11-01"`.
- [ ] **Step 2:** `pnpm test src/lib/finance/schema` → FAIL → implement → PASS.
- [ ] **Step 3: Implement** as actions, as páginas e os componentes.
- [ ] **Step 4: E2E** `finance-contracts.spec.ts`:
  - ganhar no kanban um negócio com MRR de 5.000 → em Contratos › Pendentes aparece o rascunho;
  - "Ativar" sem preencher mostra "Faltam: Dia de vencimento, Conta, Regra de fim de vigência";
  - preencher dia 10, a conta e "Renova automaticamente" e ativar → na visão Mês do mês de início aparece a entrada de R$ 5.000,00 no dia 10;
  - criar a despesa recorrente "Aluguel" de 4.674,11, fixa, dia 1 → ela aparece na visão Mês.

  Run: `pnpm test:e2e e2e/finance-contracts.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(financeiro): contratos, despesas recorrentes e configurações`

### Task 13: Visões Projeção, Clientes, Serviços e Custos

**Files:**
- Create: `financeiro/projecao/page.tsx`, `financeiro/clientes/page.tsx`, `financeiro/servicos/page.tsx`, `financeiro/custos/page.tsx`; `src/components/finance/{projection-chart,projection-table,share-chart,costs-view}.tsx`; `e2e/finance-views.spec.ts`

**Interfaces:**
- Consumes: `monthlyProjection`, `balanceSeries`, `shareBy`, `breakEven`, `coverageMonths` (Task 9), `listEntries` e `listSnapshots` (Task 10).
- Telas:
  - **Projeção**: seletor de horizonte 3/6/12/24/36; tabela com as linhas Receita bruta, Retenções, Receita líquida, Custos fixos, Custos variáveis, Não recorrentes, Resultado e Saldo no fim do mês; meses realizados com o rótulo "realizado"; gráfico de barras (entradas × saídas) com a linha de saldo (recharts, como `src/components/insights/chart`).
  - **Clientes**: tabela com cliente, receita no período, share %, MRR atual (soma das linhas recorrentes ativas do mês corrente), fim da vigência e regra; selo "vence em até 90 dias"; gráfico de barras horizontais do share.
  - **Serviços**: o mesmo, por categoria de serviço, com as cores da categoria.
  - **Custos**: cards de Custo fixo médio mensal, Ponto de equilíbrio e Cobertura ("x,x meses"); barras empilhadas fixo/variável/não recorrente por mês e tabela por categoria. Sem saldo informado, a Cobertura mostra "—" com a dica do saldo.

- [ ] **Step 1: Implement** as páginas.
- [ ] **Step 2: E2E** `finance-views.spec.ts`, com seed de dois contratos ativos (Cliente A 60.000 e Cliente B 40.000 no mês) e uma despesa fixa de 50.000:
  - Clientes mostra 60,0% e 40,0%;
  - a Projeção de 12 meses tem 12 colunas;
  - Custos mostra o ponto de equilíbrio R$ 50.000,00, já que não há variável;
  - filtrar por Cliente A em Serviços mostra só as categorias dele.

  Run: `pnpm test:e2e e2e/finance-views.spec.ts` → PASS.
- [ ] **Step 3:** `pnpm typecheck && pnpm lint` → limpos.
- [ ] **Step 4: Commit** `feat(financeiro): projeção, clientes, serviços e custos`

### Task 14: Carga inicial a partir da planilha

**Files:**
- Create: `scripts/financeiro-extract.ts`, `scripts/import-financeiro.ts`, `src/lib/finance/import/schema.ts`, `src/lib/finance/import/schema.test.ts`, `src/lib/finance/import/extract.ts`, `src/lib/finance/import/extract.test.ts`, `src/lib/finance/import/fixtures/mini.xlsx` (planilha sintética mínima, com as mesmas abas e layout, sem dados reais)
- Modify: `package.json` (scripts `financeiro:extract` e `import:financeiro`; devDependency `exceljs`), `.gitignore` (`scripts/.tmp/financeiro/`)

**Interfaces:**
- Produces:
  - `financeImportSchema` (zod) = `{ companySlug, accounts: [{ key, name, bank?, balance?, balanceDate? }], contracts: [{ key, title, organizationName, organizationId?, dueDay, retentionRate, accountKey, endRule, renewalMonths?, adjustKind, adjustIndex?, adjustRate, lines: [{ kind, description, serviceCategory, amount, firstMonth, installments?, months? }] }], recurringExpenses: [{ key, description, expenseCategory, nature, amount, frequency, dueDay, startMonth, endMonth?, installments?, accountKey? }], entries: [{ key, direction, status: "settled"|"open", date, gross, retention, description, organizationName?, serviceCategory?, incomeCategory?, expenseCategory?, nature? }], check: Record<"YYYY-MM", { in: number; out: number }> }`. `endRule` não pode ser nulo: o Step 6 da Task 14 preenche com o padrão;
  - `extractWorkbook(buf: Buffer): FinanceImportDraft`, que é o mesmo formato com `endRule: null` permitido e a lista `warnings: string[]`:
    - lê os valores calculados (`cell.result`) das abas `Despesas` e `Renda`, colunas H–S = jan–dez de 2026, coluna E = dia, coluna G = descrição, coluna B = grupo e marcadores de subgrupo "despesas fixas"/"despesas variáveis";
    - a linha de conferência é a última com "conferido" (Despesas linha 180, Renda linha 29). "conferido" = mês inteiro; "conferido até DD/MM" = até a data;
    - realizado: cada célula com valor até a data conferida vira uma entry `settled` com `key = "<aba>:<linha>:<YYYY-MM>"`. No mês parcial, as entries depois da data entram `open`;
    - "Obras – …", "Artigo fixo – …", "Lustres", "Fechadura" e "Expert Esquadrias" ficam `non_recurring`;
    - pula as linhas de total ("Total mensal:", "Despesas pagas", "Vendas líquidas") e as de "Impostos retidos na fonte – X", que viram `retention` das entradas do cliente X no mesmo mês;
    - contratos: cada linha de Vendas da aba Renda com valor no primeiro mês não conferido vira um contrato com uma linha recorrente: `amount` = valor desse mês, `firstMonth` = primeiro mês não conferido, `months` = meses restantes com valor, `retentionRate` = retenção ÷ valor × 100 (2 casas). Linhas com um único mês viram setup;
    - despesas recorrentes: linhas com valor igual em nov e dez viram `monthly` a partir de nov, com o dia da coluna E (ou 1 com um aviso);
    - `check` = soma de entradas e saídas por mês a partir do primeiro não conferido, para conferência;
  - `pnpm financeiro:extract <xlsx> [saida.json]` grava o rascunho (padrão `scripts/.tmp/financeiro/draft.json`) e imprime os avisos;
  - `pnpm import:financeiro <json> [--dry-run]`:
    - valida com `financeImportSchema`; com `endRule` nulo, falha listando os contratos;
    - resolve organizações por nome exato na empresa e falha listando as que não encontrou;
    - faz upsert por `source_key` (`import:<key>`), de modo que repetir não duplica;
    - cria contratos já `active` pela RPC `fin_activate_contract`;
    - no fim, imprime a tabela "Mês | Planilha entradas | Sistema entradas | Diferença | Planilha saídas | Sistema saídas | Diferença" para os meses de `check`;
    - usa a conexão de serviço como `scripts/import-pipedrive.ts`.

- [ ] **Step 1: Failing Vitest** `extract.test.ts` sobre `fixtures/mini.xlsx`:
  - uma despesa fixa de 100 em jan e fev com "conferido" até fev → 2 entries `settled` `fixed` com as keys `Despesas:<linha>:2026-01` e `Despesas:<linha>:2026-02`;
  - "conferido até 26/10" com uma linha de dia 30 → a entry de outubro sai `open`;
  - uma linha "Obras - pintor" sai `non_recurring`;
  - "Impostos retidos na fonte - Cliente X" de 10 com uma receita de 100 do Cliente X → a entrada tem `retention = 10` e o contrato tem `retentionRate = 10`;
  - uma linha com nov = dez = 500 vira despesa recorrente `monthly` com `startMonth` em 2026-11-01.
- [ ] **Step 2: Failing Vitest** `schema.test.ts`: um contrato com `endRule: null` falha com "Defina a regra de fim de vigência do contrato <título>.".
- [ ] **Step 3:** `pnpm test src/lib/finance/import` → FAIL → implement → PASS.
- [ ] **Step 4: Teste do import** contra o banco de desenvolvimento, com um JSON pequeno:
  - rodar `pnpm import:financeiro <json>` duas vezes → a contagem de `fin_entries` com `source_key like 'import:%'` é igual nas duas;
  - `--dry-run` não grava nada.
- [ ] **Step 5: Commit** `feat(financeiro): extração da planilha e carga inicial`
- [ ] **Step 6: Carregar a planilha real** (decisão do usuário: o módulo já sobe com todos os valores da planilha)
  - Run: `pnpm financeiro:extract ~/Downloads/2026_FINANCEIRO_OXYN.xlsx`.
  - Complete o rascunho com estes padrões:
    - `endRule = "confirm"` em todos os contratos, de modo que as renovações só entram na projeção com o filtro ligado;
    - uma conta `{ key: "itau", name: "Itaú PJ", bank: "Itaú" }` sem saldo (o usuário informa depois na tela);
    - o mapa cliente → categoria de serviço informado pelo usuário: Omni 11, Harpix Operação, Harpix CRO, Harpix CTO e Naia → Terceirização Vendas; Harpix Mentoria e Harpix Fase 1 → Consultoria Vendas.
  - Organização: se nenhuma organização da empresa casa com o nome (ignorando acentos e maiúsculas, aceitando que o nome da organização seja prefixo do nome da linha, ex.: "Harpix" para "Harpix CRO"), o import cria a organização e avisa.
  - Run: `pnpm import:financeiro scripts/.tmp/financeiro/draft.json --dry-run`, depois sem `--dry-run`. Ligue `finance_enabled` na empresa Oxyn antes.
  - Expected: a tabela de conferência com diferença 0,00 em nov e dez, ou cada diferença explicada (ex.: um valor da planilha que não se repete). Relate a tabela ao usuário.

### Task 15: Vendas do cliente e comissão (banco)

**Files:**
- Create: `supabase/migrations/20261030000008_finance_client_sales.sql`, `supabase/tests/50_finance_client_sales.test.sql`

**Interfaces:**
- Consumes: `can_finance(...,'sell')` (Task 3), linhas `commission` e `fin_entries` (Task 5), `fin_due_date`.
- Produces:
  - `fin_contract_sellers(contract_id, user_id, company_id)`, com PK `(contract_id, user_id)`. RLS: leitura com `view`, escrita com `manage`;
  - `fin_client_sales`:
    - `id, company_id, contract_id, contract_line_id (linha commission), buyer text not null, sold_on date`;
    - `setup_value numeric(14,2) default 0`, `setup_installments int default 1 check 1..60`, `setup_first_month date null`;
    - `recurring_value numeric(14,2) default 0`, `recurring_start date null`, `recurring_months int null check 1..120`;
    - `note`, `status check in ('active','cancelled') default 'active'`, `created_by`;
    - checks: `setup_value > 0 ⇒ setup_first_month`; `recurring_value > 0 ⇒ recurring_start e recurring_months`; `setup_value + recurring_value > 0`;
    - RLS: leitura com `view`. **Sem** políticas para `sell`; o vendedor usa só as funções abaixo;
  - `fin_entries.client_sale_id uuid null references fin_client_sales on delete cascade`, com índice único parcial `(client_sale_id, competence, kind_tag)`, em que `kind_tag text null check in ('setup','recurring')` é uma coluna nova;
  - `fin_regenerate_sale(p_sale uuid)` (`security definer`). Mantém liquidadas e `locked`, e na venda cancelada apaga as abertas não locked. Para cada mês M de recebimento do cliente gera uma entry `source_kind='sale'`, com `competence = M + 1 mês` e `due_date = fin_due_date(M + 1 mês, contrato.due_day)`:
    - setup: parcelas de `setup_value/setup_installments` (resíduo na última) a partir de `setup_first_month`, `gross = round(parcela * setup_rate/100, 2)`;
    - recorrência: `recurring_value` por `recurring_months` meses a partir de `recurring_start`, `gross = round(recurring_value * recurring_rate/100, 2)`;
    - `contract_line_id` fica nulo nas entries de venda (o vínculo é `client_sale_id`, com `contract_id` preenchido), para não colidir com o índice da Task 5;
    - retenção do contrato; `service_category_id` da linha; organização e conta do contrato; `description = 'Comissão – ' || buyer`;
    - gera só para M dentro da vigência da linha (incluindo renovações não `confirm`) e com o % correspondente não nulo;
  - triggers: mudança em `fin_client_sales` → `fin_regenerate_sale`; mudança de `setup_rate` ou `recurring_rate` numa linha → regenera todas as vendas da linha;
  - funções do vendedor (`security definer`, todas exigem `can_finance(company,'sell')`, senão `42501`):
    - `fin_sales_contracts(p_company uuid) returns table(contract_id uuid, line_id uuid, contract_title text, client_name text)`: contratos `active` com linha `commission`, filtrados por `fin_contract_sellers` quando o contrato tem vendedores; **não** devolve valores nem %;
    - `fin_my_sales(p_company uuid) returns table(id, contract_title, buyer, sold_on, setup_value, recurring_value, recurring_months, status, editable bool)`: só `created_by = auth.uid()`; `editable` = nenhuma entry liquidada;
    - `fin_save_sale(p_id uuid null, p_payload jsonb) returns uuid`: cria (`p_id` nulo) ou edita uma venda própria e editável; valida que o contrato e a linha estão em `fin_sales_contracts` para o usuário; quem tem `manage` edita qualquer venda;
    - `fin_cancel_sale(p_id uuid)`: a mesma regra de dono e editável.

- [ ] **Step 1: Failing pgTAP** `50_finance_client_sales.test.sql`, com um contrato ativo, `due_day = 10`, `retention_rate = 0` e uma linha de comissão com `setup_rate = 10`, `recurring_rate = 5`, de 2026-11 por 12 meses:
  - uma venda com setup de 3.000 em 3x desde 2026-11 e recorrência de 1.000 por 3 meses desde 2026-11 gera:
    - setup: 100 em 2026-12-10, 2027-01-10 e 2027-02-10;
    - recorrência: 50 nos mesmos três vencimentos;
  - uma venda com recebimento em 2027-11 (fora da vigência, `end_rule='ends'`) gera 0 entries;
  - mudar o `recurring_rate` para 6% → as entries abertas de recorrência passam a 60 e as liquidadas mantêm 50;
  - cancelar a venda → as abertas somem e as liquidadas ficam;
  - um vendedor com só `register_sales`:
    - lê 0 linhas em `fin_entries`, `fin_contracts` e `fin_client_sales` (RLS);
    - `fin_sales_contracts` devolve o contrato sem colunas de valor;
    - `fin_save_sale` cria a venda e `fin_my_sales` devolve só as dele;
    - editar a venda de outro vendedor → `42501`;
    - editar depois de uma entry liquidada → erro "Esta venda já tem comissão recebida e não pode ser alterada.";
  - com `fin_contract_sellers` preenchido sem o vendedor → o contrato some de `fin_sales_contracts` e `fin_save_sale` nele dá `42501`;
  - usuário sem `register_sales` → `42501` em todas as funções.
- [ ] **Step 2:** `pnpm test:db 50_` → FAIL.
- [ ] **Step 3: Implement** a migration.
- [ ] **Step 4:** `pnpm db:migrate && pnpm test:db` → tudo PASS.
- [ ] **Step 5: Commit** `feat(financeiro): vendas do cliente geram comissão no mês seguinte`

### Task 16: Tela de Vendas e aba Vendas do Financeiro

**Files:**
- Create: `src/lib/finance/sales-schema.ts`, `src/lib/finance/sales-schema.test.ts`, `src/lib/finance/sales-actions.ts`, `src/app/(app)/[empresa]/vendas/page.tsx`, `src/app/(app)/[empresa]/financeiro/vendas/page.tsx`, `src/components/finance/sale-form.tsx`, `src/components/finance/sales-table.tsx`, `src/components/finance/contract-sellers.tsx`, `e2e/finance-sales.spec.ts`
- Modify: `src/lib/nav.ts` e `src/lib/nav.test.ts`, `src/components/shell/app-shell.tsx`, a página de detalhe do contrato (Task 12), que ganha a seção "Vendedores autorizados" quando o contrato tem linha de comissão

**Interfaces:**
- Consumes: Task 15 (as funções `fin_sales_contracts`, `fin_my_sales`, `fin_save_sale` e `fin_cancel_sale`), `getFinanceAccess` e `salesCompanySlugs` (Task 3).
- Produces:
  - `saleSchema`:
    - `{ contractLineId: uuid, buyer 1..120, soldOn ISO, setupValue (parseBRL, ≥0), setupInstallments 1..60, setupFirstMonth? YYYY-MM, recurringValue (≥0), recurringStart? YYYY-MM, recurringMonths? 1..120, note? ≤500 }`;
    - refines: "Informe o valor do setup ou da recorrência." quando os dois são 0; "Informe o mês do primeiro recebimento do setup." quando há setup sem mês; "Informe início e meses da recorrência." quando há recorrência sem início ou meses;
  - ações: `saveSale(companyId, id | null, input): ActionResult<{id}>`, `cancelSale(id)`, `setContractSellers(contractId, userIds: string[])` (exige `manage`);
  - nav: item `{ key: "vendas", label: "Vendas", icon: Receipt, path: "/vendas", availableFromPhase: 8, scoped: true }`, que aparece com o escopo de uma empresa em `salesCompanySlugs()`;
  - `/<empresa>/vendas`: sem `sell` → `notFound()`. Mostra "Nova venda" (contrato no select com "Contrato – Cliente", sem nenhum valor de comissão) e a lista "Minhas vendas", com editar e cancelar quando `editable`. **Nenhum** import de `queries.ts` ou de tabelas `fin_*` nesta página: só as RPCs do vendedor;
  - `/<empresa>/financeiro/vendas` (exige `view`): todas as vendas, com contrato, vendedor, cliente final, valores, comissão prevista e recebida (somas das entries da venda) e filtros por contrato, vendedor e mês.

- [ ] **Step 1: Failing Vitest**: `sales-schema.test.ts` cobre os três refines com as mensagens exatas; `nav.test.ts` confirma que "Vendas" aparece só com acesso `sell`.
- [ ] **Step 2:** `pnpm test src/lib/finance/sales-schema src/lib/nav` → FAIL → implement → PASS.
- [ ] **Step 3: Implement** as páginas e os componentes.
- [ ] **Step 4: E2E** `finance-sales.spec.ts`:
  - o admin cria no contrato "Harpix Operação" uma linha de comissão de 10% no setup e 5% na recorrência e autoriza o vendedor;
  - o vendedor (papel só com `register_sales`) entra, vê "Vendas" e não vê "Financeiro" no menu, recebe 404 em `/<empresa>/financeiro` e cadastra uma venda com setup de 3.000 em 1x no mês corrente;
  - o admin vê em Financeiro › Vendas a comissão prevista de R$ 300,00 e, na visão Mês do mês seguinte, a entrada "Comissão – <cliente final>".

  Run: `pnpm test:e2e e2e/finance-sales.spec.ts` → PASS.
- [ ] **Step 5:** `pnpm typecheck && pnpm lint` → limpos. **Commit** `feat(financeiro): tela de Vendas para vendedores e aba Vendas`

### Task 17: Documentação e verificação final

**Files:**
- Modify: `README.md` (seção "Financeiro": ativação por empresa, permissões (inclusive `register_sales`), regras de geração e de comissão, horizonte e job mensal, comandos da carga inicial) e `docs/superpowers/specs/2026-10-21-oxyn-crm-design.md` (link para a spec do Financeiro na seção de fases)

- [ ] **Step 1:** Escreva a documentação.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e` → tudo verde. Anote a saída.
- [ ] **Step 3: Commit** `docs(financeiro): README e referência na spec da plataforma`
