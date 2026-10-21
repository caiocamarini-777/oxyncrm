import { SettingsNav } from "@/components/settings/settings-nav";
import { requireSuperAdmin } from "@/lib/auth/session";

export const instant = false;

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireSuperAdmin();
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
