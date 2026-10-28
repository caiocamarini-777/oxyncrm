import { BarChart3 } from "lucide-react";
import { NO_DATA } from "@/lib/insights/meta";

export function EmptyChart({ message = NO_DATA }: { message?: string }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <BarChart3 className="size-8 opacity-40" aria-hidden />
      <p>{message}</p>
    </div>
  );
}
