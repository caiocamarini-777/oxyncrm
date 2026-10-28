import { CalendarCheck, CircleDollarSign, Contact, Target, TrendingUp } from "lucide-react";
import type { EntityChoice } from "@/lib/insights/meta";
import type { DataType } from "@/lib/insights/types";

const ICONS = { activity: CalendarCheck, contact: Contact, lead: Target, deal: CircleDollarSign, forecast: TrendingUp } as const;

export function EntityIcon({ icon, className }: { icon: EntityChoice["icon"]; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden />;
}

export function iconFor(dataType: DataType | string | undefined, reportType?: string): EntityChoice["icon"] {
  if (reportType === "revenue_forecast") return "forecast";
  switch (dataType) {
    case "activities":
      return "activity";
    case "leads":
      return "lead";
    case "organizations":
    case "people":
      return "contact";
    default:
      return "deal";
  }
}
