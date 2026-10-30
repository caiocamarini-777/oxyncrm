"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/records/format";

export type ResultPoint = { label: string; resultado: number };

const tick = { fontSize: 11, fill: "currentColor" };

/** Resultado de cada mês: verde quando positivo, vermelho quando negativo. */
export function ResultChart({ data }: { data: ResultPoint[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Resultado do mês">
      <p className="mb-1 text-sm font-medium">Resultado do mês</p>
      <ResponsiveContainer width="100%" height="90%" initialDimension={{ width: 640, height: 260 }}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
          <XAxis dataKey="label" tick={tick} interval={data.length > 14 ? "preserveStartEnd" : 0} axisLine={false} tickLine={false} />
          <YAxis tick={tick} width={64} tickFormatter={(v: number) => formatMoneyCompact(v)} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "currentColor", fillOpacity: 0.06 }} formatter={(v) => formatMoney(Number(v))} />
          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} />
          <Bar dataKey="resultado" name="Resultado do mês" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.resultado >= 0 ? "#16A34A" : "var(--destructive)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
