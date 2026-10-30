# Financeiro: vigências, acumulado e alterações visíveis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every revenue and expense has a start and an end. Reports gain a cumulative in × out chart and a month-by-month result. Manual changes show an "editado" badge with the original value.

**Architecture:**
- The DB migrations extend `fin_recurring_expenses` so it holds items in both directions with a required end.
- `fin_entries` keeps the original values on the first manual edit.
- The UI reuses the existing finance pages, actions and pure calculation modules.

**Tech Stack:** Next.js 16, Supabase (Postgres, RLS, pgTAP), zod 4, recharts 3, Vitest, Playwright.

**Spec:** [docs/superpowers/specs/2026-10-30-financeiro-vigencias-design.md](../specs/2026-10-30-financeiro-vigencias-design.md). The base spec is [2026-10-29-financeiro-design.md](../specs/2026-10-29-financeiro-design.md).

## Global Constraints

- Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/` (AGENTS.md).
- Migrations: new files only. Name them `supabase/migrations/20261030000124_*.sql`, then `…125`, and so on. Never edit a migration that is already applied (000001..000123).
- pgTAP tests: `supabase/tests/52_*.test.sql` onward.
- Whenever a function or trigger is replaced with `create or replace`, start from its LATEST definition (grep all migrations) and keep every existing behavior.
- Money is `numeric(14,2)`. Months are dates on day 1. Time zone is America/Sao_Paulo.
- UI copy is in Portuguese. Server actions validate with zod and return `ActionResult`.
- Never regenerate or lose settled or locked entries.
- E2E runs on :3000 only (NEXT_PUBLIC_SITE_URL). A dev server may already be running from this worktree on :3000; reuse it, and never kill a server you didn't start.
- Commands: `pnpm db:migrate`, `pnpm test:db <trecho>`, `pnpm test <arquivo>`, `pnpm test:e2e <spec>`, `pnpm typecheck`, `pnpm lint`.

## Review Focus

1. **Legacy items with no end** (imported recurring expenses). They keep generating entries, the list shows "Defina o fim", and saving one without an end fails with "Informe o fim."
2. **Income recurring items.** They generate `direction='in'` entries with a null nature and the income or service category. Projeção and Clientes count them.
3. **Re-editing an already locked entry** does not overwrite `original_gross` or `original_due_date`.
4. **Contract line start/end ↔ months.** Converting in both directions is exact (start 2026-11, end 2027-10 = 12 months). End before start is rejected.
5. **Projeção starting in January.** Past months use only settled entries. The cumulative and result series match the table totals.

---

### Task 1: Banco — recorrentes nos dois sentidos, fim obrigatório e valor original

**Files:**
- Create: `supabase/migrations/20261030000124_finance_items_both_directions.sql`
- Create: `supabase/tests/52_finance_vigencias.test.sql`

**Interfaces:**
- `fin_recurring_expenses` gains these columns:
  - `direction text not null default 'out' check in ('in','out')`
  - `income_category_id uuid null` (fin_income_categories)
  - `service_category_id uuid null` (service_categories)
  - `organization_id uuid null` (organizations)
- `expense_category_id` becomes nullable.
- New CHECK constraints:
  - `direction='out'` ⇒ expense_category_id and nature are not null.
  - `direction='in'` ⇒ nature is null, and income_category_id or service_category_id is not null.
  - `end_month is not null`, added as `NOT VALID`. Legacy rows stay valid, but any insert or update must set it.
- Extend `guard_same_company` (latest definition) for the new FKs.
- `fin_regenerate_recurring` (latest definition, migration 118) copies the item's direction, nature, categories and organization into the entries.
- `fin_entries` gains `original_gross numeric(14,2) null` and `original_due_date date null`.
- The lock trigger function (latest definition, 115) fills them with OLD.gross and OLD.due_date at the moment it first sets `locked` (when `old.locked = false`). It never overwrites them once they are set.

- [ ] **Step 1: Failing pgTAP** `52_finance_vigencias.test.sql`:
  - An income item (in, 1.000/month, 2026-11..2027-01, income category Vendas) generates 3 entries with `direction='in'`, null nature and the category set.
  - Inserting an item with no end_month fails with 23514.
  - A legacy row with no end can still be updated if the update sets an end, and fails if it doesn't (simulate a legacy row by inserting it with the constraint temporarily dropped in the test transaction, or use `alter table … disable trigger` only if needed; a simpler alternative is to assert the constraint is NOT VALID via `pg_constraint.convalidated = false`).
  - An `out` item with no nature fails.
  - Editing the gross of a contract entry from 1.000 to 1.200 sets `locked=true`, `original_gross=1000` and `original_due_date` to the old due date. A second edit to 1.300 keeps `original_gross=1000`.
  - Settling an entry leaves both original fields null.
- [ ] **Step 2:** `pnpm test:db 52_` → FAIL.
- [ ] **Step 3: Implement** the migration.
- [ ] **Step 4:** `pnpm db:migrate && pnpm test:db` → all PASS (existing 43–51 stay green).
- [ ] **Step 5: Commit** `feat(financeiro): itens recorrentes de entrada e saída, fim obrigatório e valor original`

### Task 2: Cadastros com início e fim

**Files:**
- Modify:
  - `src/lib/finance/schema.ts` (+ tests)
  - `src/lib/finance/expenses-actions.ts`
  - `src/lib/finance/entries-actions.ts`
  - `src/components/finance/entry-dialog.tsx`
  - `src/components/finance/expense-form.tsx` (and its manager/list)
  - `src/components/finance/contract-lines-editor.tsx`
  - `src/components/finance/contract-form.tsx`
  - the contracts list and detail pages
  - `src/lib/finance/tabs.ts`
  - the Despesas page under `src/app/(app)/[empresa]/financeiro/despesas/`
- Test: `e2e/finance-vigencias.spec.ts`

**Interfaces:**
- `recurringItemSchema` replaces `recurringExpenseSchema`. It adds `direction`, `incomeCategoryId?`, `serviceCategoryId?` and `organizationId?`, and makes `endMonth` required ("Informe o fim."). Refines:
  - "Informe o fim." when end is missing.
  - "O fim não pode ser antes do início." when end is before start.
  - For `out`: expense category and nature are required. For `in`: an income or service category is required ("Escolha a categoria da receita.").
- New-entry dialog: periodicidade `once | monthly | quarterly | yearly`, plus Início (date) and Fim (date). "Única" hides Fim and uses Início as the date.
  - `once` → `createManualEntry` with dueDate = início.
  - Any other periodicidade → `createRecurringItem`, with startMonth = month of início, endMonth = month of fim and dueDay = day of início.
- Contract lines editor:
  - Recurring and commission lines show the month inputs "Início" and "Fim" instead of "Meses". The helper `monthsBetween(start, end) = (y2-y1)*12 + (m2-m1) + 1` lives in `src/lib/finance/months.ts`, with Vitest coverage including 2026-11..2027-10 = 12.
  - Setup lines show "Início" and "Parcelas", plus the computed "Fim" as read-only text.
- Contracts list and detail show "Vigência: mm/aaaa – mm/aaaa".
- The tab "Despesas" is renamed "Recorrentes", path unchanged. It lists both directions with Sentido, Início and Fim columns, and shows the badge "Defina o fim" when end_month is null.

- [ ] **Step 1: Failing Vitest** for the schema refines and `monthsBetween`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: E2E** `finance-vigencias.spec.ts`:
  - Create a monthly income item of R$ 2.000,00 from the current month to +2 months. Mês shows the entry.
  - Saving without Fim shows "Informe o fim."
  - A contract line with Início 2026-11 and Fim 2027-10 is saved with 12 months.
- [ ] **Step 4:** typecheck, lint, vitest and the finance e2e specs all green. **Commit** `feat(financeiro): início e fim em todo cadastro de receita e despesa`

### Task 3: Relatórios — acumulado e resultado mês a mês

**Files:**
- Modify:
  - `src/lib/finance/views.ts` and `src/lib/finance/calc.ts` (+ tests)
  - `src/app/(app)/[empresa]/financeiro/projecao/page.tsx`
  - `src/components/finance/projection-table.tsx`
  - `src/components/finance/projection-chart.tsx`
- Create: `src/components/finance/cumulative-chart.tsx`, `src/components/finance/result-chart.tsx`

**Interfaces:**
- `cumulativeSeries(rows: MonthRow[]): { month; inAcc; outAcc; resultAcc }[]`
  - inAcc = Σ netIn
  - outAcc = Σ (fixed + variable + nonRecurring)
  - resultAcc = Σ result
  - Sums are in cents.
- Projeção months run from January of the current year to (current month + horizon − 1). Past months come from `monthlyProjection` with `realized: true`, which already uses settled entries only. The query window (competence basis) must start at January.
- Charts:
  - Cumulative: two lines "Entradas acumuladas" and "Saídas acumuladas", with a shaded area between them.
  - Result: bars per month, green when ≥ 0 and red when < 0, labelled "Resultado do mês".
- The table gains a "Resultado acumulado" row. The "realizado" label now appears on past months.

- [ ] **Step 1: Failing Vitest** for `cumulativeSeries`: three months with results 100 / −50 / 30 give resultAcc 100 / 50 / 80.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: E2E.** Extend `e2e/finance-views.spec.ts`: Projeção shows "Entradas acumuladas" and "Resultado do mês", and the first column is January of the current year.
- [ ] **Step 4:** All green. **Commit** `feat(financeiro): gráfico acumulado e resultado mês a mês na projeção`

### Task 4: Selo de alteração manual

**Files:**
- Create: `src/components/finance/change-badge.tsx`
- Modify:
  - `src/lib/finance/queries.ts` (select original_gross, original_due_date, locked, settled_amount)
  - `src/lib/finance/filters.ts` (+ tests)
  - month view, entries table, contract detail entries list

**Interfaces:**
- `changeInfo(e): { kind: "edited" | "paid_diff" | null; text: string }` lives in `src/lib/finance/change.ts`, with Vitest coverage.
  - **edited:** `locked` and `original_gross` is not null. Text: "editado · previsto R$ X em dd/mm".
  - **paid_diff:** status settled and settled_amount ≠ amount. Text: "pago R$ Y · previsto R$ X".
  - When both apply, edited wins and the paid line is appended.
- The badge appears in the Mês list, in Lançamentos, and in the contract detail entries.
- Filter "Só alterados" is `onlyChanged: boolean` in FinanceFilters, default false, present in the URL. The query keeps `locked = true or (status = 'settled' and settled_amount <> amount)`.

- [ ] **Step 1: Failing Vitest** for `changeInfo` (each case, with exact text) and for the filters round trip with `onlyChanged`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: E2E.** In `finance-month` or a new spec:
  - Editing an entry's value shows "editado" and "previsto R$".
  - Settling with a different value shows "pago R$".
  - "Só alterados" filters the list.
- [ ] **Step 4:** All green. **Commit** `feat(financeiro): selo de alteração manual com valor original`
