// Selo de alteração manual: o que mudou em relação ao previsto (puro, sem servidor).
import { formatMoney } from "@/lib/records/format";

export type ChangeInfo = { kind: "edited" | "paid_diff" | null; text: string };

type ChangeInput = {
  status: "open" | "settled" | "cancelled";
  locked: boolean;
  amount: number;
  settledAmount: number | null;
  originalGross: number | null;
  originalDueDate: string | null;
};

const cents = (n: number) => Math.round(n * 100);

export function changeInfo(e: ChangeInput): ChangeInfo {
  const paidDiff = e.status === "settled" && e.settledAmount !== null && cents(e.settledAmount) !== cents(e.amount);
  const paid = paidDiff ? `pago ${formatMoney(e.settledAmount)}` : "";
  if (e.locked && e.originalGross !== null) {
    const [, m, d] = e.originalDueDate?.split("-") ?? [];
    const when = e.originalDueDate ? ` em ${d}/${m}` : "";
    const base = `editado · previsto ${formatMoney(e.originalGross)}${when}`;
    return { kind: "edited", text: paid ? `${base} · ${paid}` : base };
  }
  if (paidDiff) return { kind: "paid_diff", text: `${paid} · previsto ${formatMoney(e.amount)}` };
  return { kind: null, text: "" };
}
