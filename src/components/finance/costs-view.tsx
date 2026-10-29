"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, formatMoneyCompact } from "@/lib/records/format";

export type CostMonth = { label: string; fixo: number; variavel: number; naoRecorrente: number };

const tick = { fontSize: 11, fill: "currentColor" };

/** Barras empilhadas dos custos por mês: fixo, variável e não recorrente. */
export function CostsChart({ data }: { data: CostMonth[] }) {
  return (
    <div className="h-72 w-full" role="img" aria-label="Custos por mês">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 288 }}>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} maxBarSize={72}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />
          <XAxis dataKey="label" tick={tick} interval={data.length > 14 ? "preserveStartEnd" : 0} axisLine={false} tickLine={false} />
          <YAxis tick={tick} width={64} tickFormatter={(v: number) => formatMoneyCompact(v)} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "currentColor", fillOpacity: 0.06 }} formatter={(v) => formatMoney(Number(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="fixo" name="Fixo" stackId="c" fill="var(--chart-1)" stroke="var(--background)" isAnimationActive={false} />
          <Bar dataKey="variavel" name="Variável" stackId="c" fill="var(--chart-3)" stroke="var(--background)" isAnimationActive={false} />
          <Bar dataKey="naoRecorrente" name="Não recorrente" stackId="c" fill="var(--chart-5)" stroke="var(--background)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
