"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/records/format";

export type ProjectionPoint = { label: string; entradas: number; saidas: number; saldo: number | null };

const tick = { fontSize: 11, fill: "currentColor" };

/** Entradas × saídas por mês, com a linha do saldo no fim do mês (quando há saldo informado). */
export function ProjectionChart({ data }: { data: ProjectionPoint[] }) {
  return (
    <div className="h-80 w-full" role="img" aria-label="Entradas, saídas e saldo por mês">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 320 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
          <XAxis dataKey="label" tick={tick} interval={data.length > 14 ? "preserveStartEnd" : 0} axisLine={false} tickLine={false} />
          <YAxis tick={tick} width={64} tickFormatter={(v: number) => formatMoneyCompact(v)} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "currentColor", fillOpacity: 0.06 }} formatter={(v) => formatMoney(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="entradas" name="Entradas" fill="var(--chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="saidas" name="Saídas" fill="var(--chart-5)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Line dataKey="saldo" name="Saldo no fim do mês" type="monotone" stroke="var(--chart-4)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
