// Gera fixtures/mini.xlsx: planilha sintética com as abas e o layout da planilha financeira real
// (colunas H–S = jan–dez, E = dia, G = descrição, B = grupo/subgrupo), só com valores fictícios.
// Uso: pnpm exec tsx src/lib/finance/import/fixtures/make-mini.ts
import { resolve } from "node:path";
import ExcelJS from "exceljs";

const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const COL = (m: number) => String.fromCharCode("H".charCodeAt(0) + m - 1); // 1 → H … 12 → S

type Row = { b?: string; e?: number; g?: string; values?: Record<number, number>; formula?: boolean };

function sheet(wb: ExcelJS.Workbook, name: string, rows: Row[], markerRow: number) {
  const ws = wb.addWorksheet(name);
  MONTHS.forEach((m, i) => (ws.getCell(`${COL(i + 1)}1`).value = m));
  rows.forEach((r, i) => {
    const n = i + 2;
    if (r.b) ws.getCell(`B${n}`).value = r.b;
    if (r.e) ws.getCell(`E${n}`).value = r.e;
    if (r.g) ws.getCell(`G${n}`).value = r.g;
    for (const [m, v] of Object.entries(r.values ?? {})) {
      const cell = ws.getCell(`${COL(Number(m))}${n}`);
      // células de total são fórmulas com valor em cache, como no export do Google Sheets
      cell.value = r.formula ? { formula: `SUM(${COL(Number(m))}1:${COL(Number(m))}2)`, result: v } : v;
    }
  });
  for (let m = 1; m <= 9; m++) ws.getCell(`${COL(m)}${markerRow}`).value = "conferido";
  ws.getCell(`${COL(10)}${markerRow}`).value = "conferido até 26/10";
}

async function main() {
  const wb = new ExcelJS.Workbook();
  sheet(
    wb,
    "Renda",
    [
      { e: undefined, g: "Receita" }, // 2
      { b: "Vendas", g: "Total mensal:", values: { 9: 100, 11: 1100, 12: 100 }, formula: true }, // 3
      { e: 10, g: "Cliente X", values: { 9: 100, 11: 100, 12: 100 } }, // 4
      { e: 10, g: "Cliente Y Setup", values: { 11: 1000 } }, // 5
      { g: "Vendas líquidas (entra no banco)", values: { 9: 90, 11: 1090, 12: 90 }, formula: true }, // 6
      { b: "Investimentos", values: { 3: 1.5 }, formula: true }, // 7 (na planilha real, só Vendas tem "Total mensal:")
      { g: "rendimento conta", values: { 3: 1.5 } }, // 8
    ],
    9,
  );
  sheet(
    wb,
    "Despesas",
    [
      { g: "Despesas" }, // 2
      { b: "Pessoas", g: "Total mensal:", values: { 1: 100, 2: 100, 10: 200 }, formula: true }, // 3
      { b: "despesas fixas" }, // 4
      { e: 10, g: "Salário teste", values: { 1: 100, 2: 100 } }, // 5
      { e: 30, g: "Salário dia 30", values: { 10: 200 } }, // 6
      { b: "despesas variáveis" }, // 7
      { b: "Escritório / administração geral", g: "Total mensal:", values: { 8: 300 }, formula: true }, // 8
      { b: "despesas fixas" }, // 9
      { e: 5, g: "Aluguel", values: { 11: 500, 12: 500 } }, // 10
      { b: "despesas variáveis" }, // 11
      { g: "Obras - pintor", values: { 8: 300 } }, // 12
      { g: "Internet", values: { 11: 100, 12: 120 } }, // 13
      { b: "Impostos / Taxas bancárias", g: "Total mensal:", values: { 9: 10 }, formula: true }, // 14
      { b: "despesas variáveis" }, // 15
      { g: "Impostos retidos na fonte - Cliente X", values: { 9: 10, 11: 10, 12: 10 } }, // 16
      { g: "Despesas pagas (sai do banco)", values: { 1: 100 }, formula: true }, // 17
    ],
    18,
  );
  const out = resolve(__dirname, "mini.xlsx");
  await wb.xlsx.writeFile(out);
  console.log(`Gravado ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
