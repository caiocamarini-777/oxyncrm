import type { CSSProperties } from "react";
import type { DashboardItem } from "@/lib/insights/types";

/** Grade fixa (link público e impressão): mesmas posições do painel, em 4 colunas; no celular, uma coluna. */
export function StaticGrid({ items, render }: { items: DashboardItem[]; render: (reportId: string) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 md:grid md:grid-cols-4 md:[grid-auto-rows:48px]">
      {items.map((i) => (
        <div
          key={i.reportId}
          className="h-[var(--hh)] md:h-auto md:[grid-column:var(--gc)] md:[grid-row:var(--gr)]"
          style={{ "--gc": `${i.x + 1} / span ${i.w}`, "--gr": `${i.y + 1} / span ${i.h}`, "--hh": `${i.h * 56}px` } as CSSProperties}
        >
          {render(i.reportId)}
        </div>
      ))}
    </div>
  );
}
