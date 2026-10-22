import type { LabelColor } from "@/lib/custom-fields/schema";

export const LABEL_COLOR_CLASSES: Record<LabelColor, string> = {
  teal: "bg-[#1A82A2]/15 text-[#146a85] dark:text-[#75ACBA]",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  green: "bg-green-500/15 text-green-700 dark:text-green-300",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  gray: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  purple: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
};

export const LABEL_SWATCH_CLASSES: Record<LabelColor, string> = {
  teal: "bg-[#1A82A2]",
  blue: "bg-blue-500",
  green: "bg-green-500",
  red: "bg-red-500",
  gray: "bg-zinc-500",
  purple: "bg-purple-500",
};
