"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatShare } from "@/lib/finance/views";
import { formatMoney, formatMoneyCompact } from "@/lib/records/format";

export type ShareDatum = { label: string; amount: number; share: number; color: string };

const tick = { fontSize: 11, fill: "currentColor" };
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Barras horizontais da participação (cor por barra). */
export function ShareChart({ data }: { data: ShareDatum[] }) {
  return (
    <div className="w-full" role="img" aria-label="Participação na receita" style={{ height: Math.max(120, data.length * 36 + 24) }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 200 }}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 0 }} barCategoryGap={6} maxBarSize={28}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.1} horizontal={false} />
          <XAxis type="number" tick={tick} tickFormatter={(v: number) => formatMoneyCompact(v)} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" tick={tick} width={150} interval={0} tickFormatter={(v: string) => truncate(v, 22)} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "currentColor", fillOpacity: 0.06 }} formatter={(v) => formatMoney(Number(v))} />
          <Bar dataKey="amount" name="Receita" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.color} />
            ))}
            <LabelList dataKey="share" position="right" className="fill-foreground" fontSize={11} formatter={(v: unknown) => formatShare(Number(v))} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
