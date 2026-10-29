// Carga inicial do Financeiro: pnpm import:financeiro <json> [--dry-run] [--as <email>]
//
// Roda numa única transação, como o admin geral (--as, ou o primeiro admin geral ativo): troca o papel para
// `authenticated` e define o `sub` do JWT, de modo que RLS, can_finance e as RPCs (fin_activate_contract)
// valem como na tela. --dry-run executa tudo e desfaz no fim (nada fica gravado).
//
// Repetir não duplica:
// - lançamentos: upsert por source_key = "import:<key>"; um lançamento já liquidado no sistema não é alterado;
// - contratos: marcados nas observações com "[import:<key>]"; se já existe, fica como está;
// - despesas recorrentes: casadas por (empresa, descrição, categoria, mês de início); se já existe, fica como está.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnv, requireDbUrl } from "./load-env";
import { matchCategory, matchOrganization, normalizeName } from "../src/lib/finance/import/match";
import { financeImportSchema, type FinanceImport } from "../src/lib/finance/import/schema";

loadEnv();

class DryRunRollback extends Error {}
type Tx = postgres.TransactionSql;

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (v: number) => Math.round(v * 100) / 100;

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const asIdx = args.indexOf("--as");
  const as = asIdx >= 0 ? args[asIdx + 1] : undefined;
  const file = args.find((a, i) => !a.startsWith("--") && (asIdx < 0 || i !== asIdx + 1));
  if (!file || (asIdx >= 0 && !as)) {
    console.error("Uso: pnpm import:financeiro <json> [--dry-run] [--as <email>]");
    process.exit(1);
  }
  return { file, dryRun, as };
}

function load(file: string): FinanceImport {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const parsed = financeImportSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("O JSON não pode ser importado:");
    for (const i of parsed.error.issues) console.error(`- ${i.message} (${i.path.join(".")})`);
    process.exit(1);
  }
  return parsed.data;
}

async function run(tx: Tx, data: FinanceImport, opts: { dryRun: boolean; as?: string }) {
  const warnings: string[] = [];

  const [admin] = opts.as
    ? await tx`select id, email from profiles where lower(email) = lower(${opts.as}) and is_super_admin and active`
    : await tx`select id, email from profiles where is_super_admin and active order by created_at limit 1`;
  if (!admin) throw new Error(opts.as ? `${opts.as} não é um admin geral ativo.` : "Nenhum admin geral ativo.");

  const [company] = await tx`
    select id, name, finance_enabled from companies where slug = ${data.companySlug} and archived_at is null`;
  if (!company) throw new Error(`Empresa não encontrada: ${data.companySlug}.`);
  console.log(`Empresa: ${company.name} (${data.companySlug}) | como: ${admin.email}`);

  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: admin.id, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
  const companyId: string = company.id;

  if (!company.finance_enabled) {
    await tx`update companies set finance_enabled = true where id = ${companyId}`;
    console.log("Financeiro ligado na empresa (categorias semeadas).");
  }

  // Contas
  const accountIds = new Map<string, string>();
  for (const a of data.accounts) {
    let [row] = await tx`select id from fin_accounts where company_id = ${companyId} and lower(name) = lower(${a.name})`;
    if (!row) {
      [row] = await tx`insert into fin_accounts (company_id, name, bank) values (${companyId}, ${a.name}, ${a.bank ?? null}) returning id`;
      console.log(`Conta criada: ${a.name}`);
    }
    accountIds.set(a.key, row.id);
    if (a.balance !== undefined) {
      const asOf = a.balanceDate ?? new Date().toISOString().slice(0, 10);
      await tx`
        insert into fin_balance_snapshots (company_id, account_id, as_of, balance)
        values (${companyId}, ${row.id}, ${asOf}, ${a.balance})
        on conflict (account_id, as_of) do update set balance = excluded.balance`;
    }
  }
  const account = (key: string | null | undefined) => (key ? accountIds.get(key)! : null);

  // Categorias (casadas pelo nome normalizado; falha listando as que não existem)
  const expenseCats = await tx`select id, name from fin_expense_categories where company_id = ${companyId}`;
  const incomeCats = await tx`select id, name from fin_income_categories where company_id = ${companyId}`;
  const serviceCats = await tx`select id, name from service_categories where company_id = ${companyId}`;
  const missing = new Set<string>();
  const resolver = (rows: postgres.RowList<postgres.Row[]>, label: string) => {
    const names = rows.map((r) => r.name as string);
    return (name: string | null | undefined): string | null => {
      if (!name) return null;
      const hit = matchCategory(name, names);
      if (!hit) {
        missing.add(`${label} "${name}"`);
        return null;
      }
      return rows.find((r) => r.name === hit)!.id;
    };
  };
  const expenseCat = resolver(expenseCats, "categoria de despesa");
  const incomeCat = resolver(incomeCats, "categoria de receita");
  const serviceCat = resolver(serviceCats, "categoria de serviço");
  for (const c of data.contracts) for (const l of c.lines) serviceCat(l.serviceCategory);
  for (const r of data.recurringExpenses) expenseCat(r.expenseCategory);
  for (const e of data.entries) {
    expenseCat(e.expenseCategory);
    incomeCat(e.incomeCategory);
    serviceCat(e.serviceCategory);
  }
  if (missing.size > 0) throw new Error(`Categorias não encontradas na empresa: ${[...missing].join(", ")}.`);

  // Organizações: igual ou prefixo do nome da linha; sem correspondência, cria e avisa.
  const orgs = (await tx`
    select id, name from organizations where company_id = ${companyId} and deleted_at is null`) as unknown as {
    id: string;
    name: string;
  }[];
  const orgCache = new Map<string, string>();
  let orgsCreated = 0;
  const organization = async (name: string | undefined, explicit?: string): Promise<string | null> => {
    if (explicit) return explicit;
    if (!name) return null;
    const cached = orgCache.get(normalizeName(name));
    if (cached) return cached;
    let hit = matchOrganization(name, orgs);
    if (!hit) {
      const [row] = await tx`
        insert into organizations (company_id, owner_id, name) values (${companyId}, ${admin.id}, ${name})
        returning id, name`;
      hit = { id: row.id, name: row.name };
      orgs.push(hit);
      orgsCreated++;
      warnings.push(`Organização criada: ${name}.`);
    } else if (normalizeName(hit.name) !== normalizeName(name)) {
      console.log(`Organização: "${name}" → ${hit.name}`);
    }
    orgCache.set(normalizeName(name), hit.id);
    return hit.id;
  };

  // Contratos: criados em rascunho e ativados pela RPC (o trigger gera os lançamentos).
  let contractsCreated = 0;
  let contractsKept = 0;
  for (const c of data.contracts) {
    const marker = `[import:${c.key}]`;
    const [existing] = await tx`
      select id from fin_contracts where company_id = ${companyId} and position(${marker} in coalesce(notes, '')) > 0`;
    if (existing) {
      contractsKept++;
      continue;
    }
    const orgId = await organization(c.organizationName, c.organizationId);
    const [row] = await tx`
      insert into fin_contracts (company_id, organization_id, title, due_day, retention_rate, account_id, end_rule,
        renewal_months, adjust_kind, adjust_index, adjust_rate, notes)
      values (${companyId}, ${orgId}, ${c.title}, ${c.dueDay}, ${c.retentionRate}, ${account(c.accountKey)},
        ${c.endRule}, ${c.renewalMonths ?? null}, ${c.adjustKind}, ${c.adjustIndex ?? null}, ${c.adjustRate},
        ${`Importado da planilha ${marker}`})
      returning id`;
    for (const l of c.lines) {
      await tx`
        insert into fin_contract_lines (contract_id, company_id, kind, description, service_category_id, amount,
          first_month, installments, months)
        values (${row.id}, ${companyId}, ${l.kind}, ${l.description}, ${serviceCat(l.serviceCategory)}, ${l.amount},
          ${l.firstMonth}, ${l.installments ?? 1}, ${l.months ?? null})`;
    }
    await tx`select fin_activate_contract(${row.id})`;
    contractsCreated++;
  }

  // Despesas recorrentes (o trigger gera os lançamentos).
  let expensesCreated = 0;
  let expensesKept = 0;
  for (const r of data.recurringExpenses) {
    const catId = expenseCat(r.expenseCategory);
    const [existing] = await tx`
      select id from fin_recurring_expenses
       where company_id = ${companyId} and lower(description) = lower(${r.description})
         and expense_category_id = ${catId} and start_month = ${r.startMonth}`;
    if (existing) {
      expensesKept++;
      continue;
    }
    await tx`
      insert into fin_recurring_expenses (company_id, description, expense_category_id, nature, amount, frequency,
        due_day, start_month, end_month, installments, account_id)
      values (${companyId}, ${r.description}, ${catId}, ${r.nature}, ${r.amount}, ${r.frequency}, ${r.dueDay},
        ${r.startMonth}, ${r.endMonth ?? null}, ${r.installments ?? null}, ${account(r.accountKey)})`;
    expensesCreated++;
  }

  // Lançamentos: upsert por source_key; os já liquidados no sistema não mudam.
  const rows = [];
  for (const e of data.entries) {
    const settled = e.status === "settled";
    rows.push({
      company_id: companyId,
      direction: e.direction,
      source_kind: "import",
      source_key: `import:${e.key}`,
      due_date: e.date,
      competence: `${e.date.slice(0, 7)}-01`,
      gross: e.gross,
      retention: e.retention,
      status: e.status,
      settled_on: settled ? e.date : null,
      settled_amount: settled ? round2(e.gross - e.retention) : null,
      account_id: account(e.accountKey),
      organization_id: await organization(e.organizationName),
      service_category_id: serviceCat(e.serviceCategory),
      income_category_id: e.direction === "in" ? incomeCat(e.incomeCategory) : null,
      expense_category_id: e.direction === "out" ? expenseCat(e.expenseCategory) : null,
      nature: e.direction === "out" ? e.nature! : null,
      description: e.description,
    });
  }
  let inserted = 0;
  let updated = 0;
  const cols = Object.keys(rows[0] ?? {}) as (keyof (typeof rows)[number])[];
  for (let i = 0; i < rows.length; i += 200) {
    const res = await tx`
      insert into fin_entries ${tx(rows.slice(i, i + 200), cols)}
      on conflict (company_id, source_key) where source_key is not null do update set
        direction = excluded.direction, due_date = excluded.due_date, competence = excluded.competence,
        gross = excluded.gross, retention = excluded.retention, status = excluded.status,
        settled_on = excluded.settled_on, settled_amount = excluded.settled_amount, account_id = excluded.account_id,
        organization_id = excluded.organization_id, service_category_id = excluded.service_category_id,
        income_category_id = excluded.income_category_id, expense_category_id = excluded.expense_category_id,
        nature = excluded.nature, description = excluded.description
      where fin_entries.status = 'open'
      returning (xmax = 0) as inserted`;
    for (const r of res) {
      if (r.inserted) inserted++;
      else updated++;
    }
  }
  const kept = rows.length - inserted - updated;

  // Resumo
  const [counts] = await tx`
    select count(*) filter (where source_key like 'import:%') as imported,
           count(*) filter (where source_key like 'import:%' and status = 'settled') as settled,
           count(*) filter (where source_key like 'import:%' and status = 'open') as open,
           count(*) filter (where source_kind = 'contract') as contract,
           count(*) filter (where source_kind = 'recurring') as recurring
      from fin_entries where company_id = ${companyId}`;
  console.log(
    `\nContratos: ${contractsCreated} criados e ativados, ${contractsKept} já existiam` +
      `\nDespesas recorrentes: ${expensesCreated} criadas, ${expensesKept} já existiam` +
      `\nOrganizações criadas: ${orgsCreated}` +
      `\nLançamentos do JSON: ${inserted} inseridos, ${updated} atualizados, ${kept} mantidos (já liquidados no sistema)` +
      `\nNo banco: ${counts.imported} lançamentos importados (${counts.settled} liquidados, ${counts.open} em aberto), ` +
      `${counts.contract} gerados por contrato, ${counts.recurring} por despesa recorrente`,
  );

  // Conferência por mês: entradas líquidas (valor − retenção) e saídas, sem canceladas nem renovações a confirmar.
  const months = Object.keys(data.check).sort();
  if (months.length > 0) {
    const sys = await tx`
      select to_char(competence, 'YYYY-MM') as month,
             coalesce(sum(amount) filter (where direction = 'in'), 0)::float8 as "in",
             coalesce(sum(amount) filter (where direction = 'out'), 0)::float8 as "out"
        from fin_entries
       where company_id = ${companyId} and status <> 'cancelled' and not renewal_pending
         and to_char(competence, 'YYYY-MM') = any(${months})
       group by 1`;
    const byMonth = new Map(sys.map((r) => [r.month as string, r]));
    const table = months.map((m) => {
      const p = data.check[m];
      const s = byMonth.get(m) ?? { in: 0, out: 0 };
      return [m, brl(p.in), brl(s.in), brl(round2(s.in - p.in)), brl(p.out), brl(s.out), brl(round2(s.out - p.out))];
    });
    const header = ["Mês", "Planilha entradas", "Sistema entradas", "Diferença", "Planilha saídas", "Sistema saídas", "Diferença"];
    const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
    const fmt = (r: string[]) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(" | ");
    console.log(`\n${fmt(header)}\n${widths.map((w) => "-".repeat(w)).join("-|-")}`);
    for (const r of table) console.log(fmt(r));
  }

  if (warnings.length > 0) {
    console.log(`\nAvisos (${warnings.length}):`);
    for (const w of warnings) console.log(`- ${w}`);
  }
  if (opts.dryRun) throw new DryRunRollback();
}

async function main() {
  const { file, dryRun, as } = parseArgs();
  const data = load(file);
  const sql = postgres(requireDbUrl(), { max: 1, onnotice: () => {} });
  if (dryRun) console.log("Simulação: tudo roda numa transação desfeita no fim; nada será gravado.");
  try {
    await sql.begin((tx) => run(tx, data, { dryRun, as }));
    console.log("\nCarga concluída.");
  } catch (e) {
    if (e instanceof DryRunRollback) {
      console.log("\nSimulação concluída: transação desfeita.");
    } else {
      const err = e as { message?: string; detail?: string };
      console.error(`Falhou (nada foi gravado): ${err.message ?? e}${err.detail ? ` — ${err.detail}` : ""}`);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main();
