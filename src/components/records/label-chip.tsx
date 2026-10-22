import { cn } from "cn";
import { LABEL_COLOR_CLASSES } from "@/lib/labels/colors";
import type { LabelColor } from "@/lib/custom-fields/schema";

export function LabelChip({ color, name }: { color: LabelColor; name: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        LABEL_COLOR_CLASSES[color] ?? LABEL_COLOR_CLASSES.gray,
      )}
    >
      {name}
    </span>
  );
}
