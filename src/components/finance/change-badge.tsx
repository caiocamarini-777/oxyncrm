import { Badge } from "@/components/ui/badge";
import type { EntryRow } from "@/lib/finance/calc";
import { changeInfo } from "@/lib/finance/change";

/** Selo de alteração manual: mostra o valor/data original (ou o previsto, se o pago difere). */
export function ChangeBadge({ entry }: { entry: EntryRow }) {
  const info = changeInfo(entry);
  if (!info.kind) return null;
  return (
    <Badge variant="outline" data-change={info.kind} className="h-auto whitespace-normal text-xs font-normal">
      {info.text}
    </Badge>
  );
}
