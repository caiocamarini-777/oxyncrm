"use client";

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/records/format";

export type CumulativePoint = { label: string; entradas: number; saidas: number; faixa: [number, number] };

const tick = { fontSize: 11, fill: "currentColor" };

/** Entradas e saídas acumuladas desde janeiro, com a área entre as duas linhas sombreada. */
export function CumulativeChart({ data }: { data: CumulativePoint[] }) {
  return (
    <div className="h-80 w-full" role="img" aria-label="Entradas e saídas acumuladas por mês">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 320 }}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
          <XAxis dataKey="label" tick={tick} interval={data.length > 14 ? "preserveStartEnd" : 0} axisLine={false} tickLine={false} />
          <YAxis tick={tick} width={64} tickFormatter={(v: number) => formatMoneyCompact(v)} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => (Array.isArray(v) ? null : formatMoney(Number(v)))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area dataKey="faixa" name="Diferença" legendType="none" tooltipType="none" stroke="none" fill="var(--chart-1)" fillOpacity={0.15} isAnimationActive={false} />
          <Line dataKey="entradas" name="Entradas acumuladas" type="monotone" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line dataKey="saidas" name="Saídas acumuladas" type="monotone" stroke="var(--chart-5)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
