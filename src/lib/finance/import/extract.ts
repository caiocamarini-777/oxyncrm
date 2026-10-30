// Extrai o rascunho da carga inicial do Financeiro da planilha anual (abas "Renda" e "Despesas").
// Layout: colunas H–S = jan–dez, E = dia de pagamento, G = descrição, B = grupo (linha com "Total mensal:")
// e marcadores de subgrupo "despesas fixas"/"despesas variáveis". A última linha com "conferido" diz até
// quando cada mês foi conferido ("conferido" = mês inteiro; "conferido até DD/MM" = até a data).
import ExcelJS from "exceljs";
import { matchCategory, normalizeName, SEED_EXPENSE_CATEGORIES, SEED_INCOME_CATEGORIES } from "./match";
import type { FinanceImportDraft } from "./schema";

type Nature = "fixed" | "variable" | "non_recurring";
type SheetName = "Renda" | "Despesas";

export type SheetRow = {
  row: number;
  b: string | null;
  e: number | null;
  g: string | null;
  /** índice 0 = janeiro (coluna H) */
  months: (number | null)[];
  texts: (string | null)[];
};

type Line = {
  sheet: SheetName;
  row: number;
  group: string;
  category: string;
  nature: Nature | null;
  day: number | null;
  description: string;
  values: (number | null)[];
};

const FIRST_MONTH_COL = 8; // H
const round2 = (v: number) => Math.round(v * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const clean = (s: string | null) => (s ? s.replace(/[\s·]+/g, " ").trim() || null : null);

function lastDay(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function makeDate(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(Math.min(day, lastDay(year, month)))}`;
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return v;
  if (v instanceof Date) return v;
  if ("result" in v) return v.result ?? null; // fórmula com valor em cache
  if ("richText" in v) return v.richText.map((t) => t.text).join("");
  if ("text" in v) return typeof v.text === "string" ? v.text : null; // hiperlink
  return null; // fórmula sem cache, erro
}

export function readSheet(ws: ExcelJS.Worksheet): SheetRow[] {
  const rows: SheetRow[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const text = (c: number) => {
      const v = cellValue(row.getCell(c).value);
      return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
    };
    const months: (number | null)[] = [];
    const texts: (string | null)[] = [];
    for (let m = 0; m < 12; m++) {
      const v = cellValue(row.getCell(FIRST_MONTH_COL + m).value);
      months.push(typeof v === "number" && Number.isFinite(v) && round2(v) !== 0 ? round2(v) : null);
      texts.push(typeof v === "string" ? v.trim() : null);
    }
    const e = cellValue(row.getCell(5).value);
    rows.push({
      row: r,
      b: clean(text(2)),
      e: typeof e === "number" && Number.isInteger(e) && e >= 1 && e <= 31 ? e : null,
      g: clean(text(7)),
      months,
      texts,
    });
  }
  return rows;
}

/** Linha de conferência: a última com "conferido" em algum mês. Devolve o corte (data ISO) por mês. */
function readMarkers(rows: SheetRow[], year: number, sheet: SheetName) {
  const markerRow = [...rows].reverse().find((r) => r.texts.some((t) => t && /^conferido/i.test(t)));
  if (!markerRow) throw new Error(`Aba ${sheet}: nenhuma linha com "conferido".`);
  const cutoff: (string | null)[] = markerRow.texts.map((t, i) => {
    if (!t || !/^conferido/i.test(t)) return null;
    const m = /at[eé]\s+(\d{1,2})\/(\d{1,2})/i.exec(t);
    if (m) return `${year}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
    return makeDate(year, i + 1, 31);
  });
  let last = 0;
  cutoff.forEach((c, i) => {
    if (c) last = i + 1;
  });
  return { markerRow: markerRow.row, cutoff, lastConferred: last };
}

const NON_RECURRING = ["obras", "artigofixo", "lustres", "fechadura"];
function isNonRecurring(description: string) {
  const n = normalizeName(description);
  return NON_RECURRING.some((p) => n.startsWith(p)) || n.includes("expertesquadrias");
}

function readLines(sheet: SheetName, rows: SheetRow[], markerRow: number, retentions: Line[]): Line[] {
  const lines: Line[] = [];
  const unmapped = new Set<string>();
  const options = sheet === "Despesas" ? Object.keys(SEED_EXPENSE_CATEGORIES) : SEED_INCOME_CATEGORIES;
  let group: string | null = null;
  let category: string | null = null;
  let nature: Nature | null = null;

  for (const r of rows) {
    if (r.row >= markerRow) break;
    const bn = r.b ? normalizeName(r.b) : "";
    if (bn === "despesasfixas") nature = "fixed";
    else if (bn === "despesasvariaveis") nature = "variable";
    // Grupo: texto na coluna B que não é marcador de subgrupo (na aba Renda, só Vendas tem "Total mensal:")
    else if (r.b || (r.g && /^total mensal/i.test(r.g))) {
      group = r.b;
      nature = null;
      category = group ? matchCategory(group, options) : null;
      if (!category) unmapped.add(group ?? `(linha ${r.row} sem grupo)`);
      continue;
    }
    if (!r.g || !group || !category) continue;
    if (/^total mensal/i.test(r.g)) continue;
    if (/^(despesas pagas|vendas l[ií]quidas)/i.test(r.g)) continue;
    if (!r.months.some((v) => v !== null)) continue;

    const line: Line = {
      sheet,
      row: r.row,
      group,
      category,
      nature:
        sheet === "Renda"
          ? null
          : isNonRecurring(r.g)
            ? "non_recurring"
            : (nature ?? SEED_EXPENSE_CATEGORIES[category]),
      day: r.e,
      description: r.g,
      values: r.months,
    };
    if (sheet === "Despesas" && /^impostos retidos na fonte/i.test(r.g)) retentions.push(line);
    else lines.push(line);
  }
  if (unmapped.size > 0) {
    throw new Error(
      `Aba ${sheet}: grupos sem categoria correspondente: ${[...unmapped].join(", ")}. ` +
        `Categorias aceitas: ${options.join(", ")}.`,
    );
  }
  return lines;
}

/** Cliente da linha "Impostos retidos na fonte - X" (sem o complemento entre parênteses). */
function retentionClient(description: string) {
  const m = /^impostos retidos na fonte\s*[-–—]\s*(.+)$/i.exec(description);
  return m ? m[1].replace(/\(.*?\)/g, "").trim() : "";
}

export async function extractWorkbook(buf: Buffer | ArrayBuffer, opts: { year?: number } = {}): Promise<FinanceImportDraft> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const sheet = (name: SheetName) => {
    const ws = wb.getWorksheet(name);
    if (!ws) throw new Error(`A planilha não tem a aba "${name}".`);
    return readSheet(ws);
  };
  return extractFromRows({ Renda: sheet("Renda"), Despesas: sheet("Despesas") }, opts.year ?? 2026);
}

export function extractFromRows(sheets: Record<SheetName, SheetRow[]>, year: number): FinanceImportDraft {
  const warnings: string[] = [];
  const renda = readMarkers(sheets.Renda, year, "Renda");
  const desp = readMarkers(sheets.Despesas, year, "Despesas");
  if (renda.lastConferred !== desp.lastConferred) {
    warnings.push(
      `As abas foram conferidas até meses diferentes (Renda: ${renda.lastConferred}, Despesas: ${desp.lastConferred}); ` +
        `a projeção começa depois do maior.`,
    );
  }
  const firstOpen = Math.max(renda.lastConferred, desp.lastConferred) + 1; // 1–12, ou 13 = nada a projetar
  const firstOpenMonth = firstOpen <= 12 ? `${year}-${pad(firstOpen)}-01` : null;
  const markers = { Renda: renda, Despesas: desp };

  const retentionRows: Line[] = [];
  const income = readLines("Renda", sheets.Renda, renda.markerRow, retentionRows);
  const expenses = readLines("Despesas", sheets.Despesas, desp.markerRow, retentionRows);

  // Retenção na fonte: rateada entre as linhas de receita do cliente no mês, proporcional ao valor.
  const retention = new Map<string, number>(); // `${row}:${monthIdx}` → valor
  for (const r of retentionRows) {
    const client = normalizeName(retentionClient(r.description));
    const targets = income.filter((l) => client && normalizeName(l.description).startsWith(client));
    if (targets.length === 0) {
      warnings.push(`"${r.description}" (Despesas:${r.row}) não casa com nenhuma linha da aba Renda; a retenção foi ignorada.`);
      continue;
    }
    if (targets.length > 1) {
      warnings.push(
        `"${r.description}" é rateada entre ${targets.map((t) => t.description).join(", ")} ` +
          `proporcionalmente ao valor de cada linha no mês.`,
      );
    }
    r.values.forEach((value, m) => {
      if (value === null) return;
      const withValue = targets.filter((t) => t.values[m] !== null);
      if (withValue.length === 0) {
        warnings.push(`"${r.description}" tem ${value} em ${pad(m + 1)}/${year} sem receita do cliente no mês; ignorada.`);
        return;
      }
      const total = withValue.reduce((s, t) => s + (t.values[m] ?? 0), 0);
      let acc = 0;
      withValue.forEach((t, i) => {
        const part = i < withValue.length - 1 ? round2((value * (t.values[m] ?? 0)) / total) : round2(value - acc);
        acc = round2(acc + part);
        const key = `${t.row}:${m}`;
        retention.set(key, round2((retention.get(key) ?? 0) + part));
      });
    });
  }

  const dueDay = (l: Line, why: string) => {
    if (l.day) return l.day;
    warnings.push(`${l.sheet}:${l.row} "${l.description}" não tem dia (coluna E); ${why} usa o dia 1.`);
    return 1;
  };

  // Contratos: linhas de Vendas com valor no primeiro mês não conferido.
  const covered = new Set<string>(); // `${sheet}:${row}:${monthIdx}`
  const contracts: FinanceImportDraft["contracts"] = [];
  if (firstOpenMonth) {
    for (const l of income) {
      if (normalizeName(l.category) !== "vendas") continue;
      const start = firstOpen - 1;
      const amount = l.values[start];
      if (amount === null) continue;
      let months = 0;
      while (start + months < 12 && l.values[start + months] === amount) months++;
      for (let m = start; m < start + months; m++) covered.add(`Renda:${l.row}:${m}`);
      const later = l.values.slice(start + months).filter((v) => v !== null);
      if (later.length > 0) {
        warnings.push(`Renda:${l.row} "${l.description}" muda de valor depois de ${months} mês(es); o resto entra como lançamentos avulsos.`);
      }
      const ret = retention.get(`${l.row}:${start}`) ?? 0;
      for (let m = start + 1; m < start + months; m++) {
        if ((retention.get(`${l.row}:${m}`) ?? 0) !== ret) {
          warnings.push(`Renda:${l.row} "${l.description}": a retenção muda entre os meses; o contrato usa a de ${pad(firstOpen)}/${year}.`);
          break;
        }
      }
      const setup = months === 1;
      contracts.push({
        key: `Renda:${l.row}`,
        title: l.description,
        organizationName: l.description,
        dueDay: dueDay(l, "o contrato"),
        retentionRate: round2((ret / amount) * 100),
        accountKey: null,
        endRule: null,
        adjustKind: "none",
        adjustRate: 0,
        lines: [
          setup
            ? { kind: "setup", description: "Setup", serviceCategory: null, amount, firstMonth: firstOpenMonth, installments: 1 }
            : { kind: "recurring", description: "Mensalidade", serviceCategory: null, amount, firstMonth: firstOpenMonth, months },
        ],
      });
    }
  }

  // Despesas recorrentes: mesmo valor em todos os meses restantes do ano (nov = dez).
  const recurringExpenses: FinanceImportDraft["recurringExpenses"] = [];
  if (firstOpenMonth && firstOpen < 12) {
    for (const l of expenses) {
      const rest = l.values.slice(firstOpen - 1);
      const amount = rest[0];
      if (amount === null || !rest.every((v) => v === amount)) continue;
      if (l.nature === "non_recurring") {
        warnings.push(`Despesas:${l.row} "${l.description}" se repete, mas é não recorrente; fica como lançamentos avulsos.`);
        continue;
      }
      for (let m = firstOpen - 1; m < 12; m++) covered.add(`Despesas:${l.row}:${m}`);
      recurringExpenses.push({
        key: `Despesas:${l.row}`,
        description: l.description,
        expenseCategory: l.category,
        nature: l.nature ?? "variable",
        amount,
        frequency: "monthly",
        dueDay: dueDay(l, "a despesa recorrente"),
        startMonth: firstOpenMonth,
        accountKey: null,
      });
    }
  }

  // Lançamentos: realizado (até o mês conferido) e valores futuros que não viraram contrato/recorrente.
  const entries: FinanceImportDraft["entries"] = [];
  const noDaySettled: string[] = [];
  for (const l of [...income, ...expenses]) {
    const mk = markers[l.sheet];
    let warnedOpen = false;
    l.values.forEach((gross, m) => {
      if (gross === null || covered.has(`${l.sheet}:${l.row}:${m}`)) return;
      const date = makeDate(year, m + 1, l.day ?? 1);
      const cut = mk.cutoff[m];
      const status = cut && date <= cut ? "settled" : "open";
      if (!l.day) {
        if (status === "settled") {
          if (!noDaySettled.includes(`${l.sheet}:${l.row}`)) noDaySettled.push(`${l.sheet}:${l.row}`);
        } else if (!warnedOpen) {
          warnedOpen = true;
          dueDay(l, "o lançamento em aberto");
        }
      }
      const base = {
        key: `${l.sheet}:${l.row}:${year}-${pad(m + 1)}`,
        status,
        date,
        gross,
        description: l.description,
      } as const;
      entries.push(
        l.sheet === "Renda"
          ? {
              ...base,
              direction: "in",
              retention: retention.get(`${l.row}:${m}`) ?? 0,
              incomeCategory: l.category,
              ...(normalizeName(l.category) === "vendas" ? { organizationName: l.description, serviceCategory: null } : {}),
            }
          : { ...base, direction: "out", retention: 0, expenseCategory: l.category, nature: l.nature ?? "variable" },
      );
    });
  }
  if (noDaySettled.length > 0) {
    warnings.push(`${noDaySettled.length} linha(s) sem dia (coluna E) entram liquidadas no dia 1 do mês: ${noDaySettled.join(", ")}.`);
  }

  // Conferência: entradas líquidas (receitas − retenções) e saídas (sem as retenções), por mês projetado.
  const check: FinanceImportDraft["check"] = {};
  if (firstOpenMonth) {
    for (let m = firstOpen - 1; m < 12; m++) {
      const sum = (ls: Line[]) => ls.reduce((s, l) => s + (l.values[m] ?? 0), 0);
      check[`${year}-${pad(m + 1)}`] = {
        in: round2(sum(income) - sum(retentionRows)),
        out: round2(sum(expenses)),
      };
    }
  }

  return { companySlug: "", accounts: [], contracts, recurringExpenses, entries, check, warnings };
}
