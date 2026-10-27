import Link from "next/link";
import { BarChart3, LineChart, PieChart, Table2, Filter } from "lucide-react";
import type { Preset } from "@/lib/reports/presets";
import type { Chart } from "@/lib/reports/spec";

const ICON: Record<Chart, typeof BarChart3> = {
  number: BarChart3,
  bar: BarChart3,
  column: BarChart3,
  line: LineChart,
  funnel: Filter,
  pie: PieChart,
  table: Table2,
  list: Table2,
};

export function PresetCard({ preset, href }: { preset: Preset; href: string }) {
  const Icon = ICON[preset.chart];
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-lg border bg-card p-4 transition-colors hover:border-[var(--color-brand)] focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex size-9 items-center justify-center rounded-md bg-[var(--color-brand)]/10 text-[var(--color-brand)]">
        <Icon className="size-5" />
      </span>
      <h3 className="font-heading text-base font-semibold">{preset.name}</h3>
      <p className="text-sm text-muted-foreground">{preset.description}</p>
    </Link>
  );
}
