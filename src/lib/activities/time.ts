/** Horários guardados em UTC; hoje, atrasadas e agenda são calculados em São Paulo. */
export const TZ = "America/Sao_Paulo";

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

type Parts = { y: number; mo: number; d: number; h: number; mi: number };

function partsOf(date: Date): Parts {
  const p: Record<string, number> = {};
  for (const x of partsFmt.formatToParts(date)) if (x.type !== "literal") p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

/** "YYYY-MM-DDTHH:mm" (parede de São Paulo) para ISO em UTC. */
export function toUtc(localIso: string): string {
  const m = LOCAL_RE.exec(localIso);
  if (!m) throw new Error("Data e hora inválidas.");
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const p = partsOf(new Date(t));
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - t;
  };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  const out = new Date(t);
  if (Number.isNaN(out.getTime())) throw new Error("Data e hora inválidas.");
  return out.toISOString();
}

/** ISO em UTC para o valor de `<input type="datetime-local">` em São Paulo. */
export function toLocalInput(utcIso: string): string {
  const p = partsOf(toDate(utcIso));
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Dia (`YYYY-MM-DD`) em São Paulo. */
export function dayKey(utc: string | Date): string {
  const p = partsOf(toDate(utc));
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
}

function dayNumber(key: string): number {
  const m = DAY_RE.exec(key);
  if (!m) throw new Error("Dia inválido.");
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000);
}

function keyOf(dayNum: number): string {
  const d = new Date(dayNum * 86_400_000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const weekday = (dayNum: number) => (new Date(dayNum * 86_400_000).getUTCDay() + 6) % 7; // 0 = segunda

/** Início do dia de São Paulo (ISO UTC) para o dia `YYYY-MM-DD`. */
export function startOfDayUtc(key: string): string {
  return toUtc(`${key}T00:00`);
}

/** Início do dia seguinte (ISO UTC), para limites semiabertos. */
export function startOfNextDayUtc(key: string): string {
  return toUtc(`${keyOf(dayNumber(key) + 1)}T00:00`);
}

export type DueStatus = "done" | "overdue" | "today" | "upcoming";

/** Atrasada = horário já passou (mesma regra do banco); hoje = ainda por vir no dia de São Paulo. */
export function dueStatus(dueAt: string | Date, done: boolean, now: Date): DueStatus {
  if (done) return "done";
  const due = toDate(dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  return dayKey(due) === dayKey(now) ? "today" : "upcoming";
}

/** Sete dias, de segunda a domingo, da semana do dia `anchor` (`YYYY-MM-DD`). */
export function weekGrid(anchor: string): string[] {
  const n = dayNumber(anchor);
  const start = n - weekday(n);
  return Array.from({ length: 7 }, (_, i) => keyOf(start + i));
}

/** Semanas completas (segunda a domingo) que cobrem o mês do dia `anchor`. */
export function monthGrid(anchor: string): string[][] {
  const [y, mo] = anchor.split("-").map(Number);
  const first = Math.floor(Date.UTC(y, mo - 1, 1) / 86_400_000);
  const last = Math.floor(Date.UTC(y, mo, 0) / 86_400_000);
  const weeks: string[][] = [];
  for (let s = first - weekday(first); s <= last; s += 7) {
    weeks.push(Array.from({ length: 7 }, (_, i) => keyOf(s + i)));
  }
  return weeks;
}

const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short" });

export const formatTime = (utc: string | Date) => timeFmt.format(toDate(utc));

/** "23/10, 23:30" em São Paulo. */
export function formatDateTime(utc: string | Date): string {
  return `${dateFmt.format(toDate(utc))}, ${formatTime(utc)}`;
}

/** "Hoje, 14:30", "Amanhã, 09:00", "qua., 23/10, 10:00" ou "Atrasada há 2 dias". */
export function formatDue(utc: string | Date, now: Date): string {
  const due = toDate(utc);
  const diff = dayNumber(dayKey(due)) - dayNumber(dayKey(now));
  if (diff === 0) return `Hoje, ${formatTime(due)}`;
  if (diff === 1) return `Amanhã, ${formatTime(due)}`;
  if (diff < 0) return `Atrasada há ${-diff} ${diff === -1 ? "dia" : "dias"}`;
  return `${weekdayFmt.format(due)}, ${dateFmt.format(due)}, ${formatTime(due)}`;
}
