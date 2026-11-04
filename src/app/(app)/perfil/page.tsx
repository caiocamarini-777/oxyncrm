import { Suspense } from "react";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { PasswordForm } from "@/components/profile/password-form";
import { ProfileForm } from "@/components/profile/profile-form";
import { EmailAccounts, type GmailFlash, type MailboxView } from "@/components/profile/email-accounts";
import { ThemePreference } from "@/components/profile/theme-preference";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies } from "@/lib/companies/scope";
import { gmailConfig } from "@/lib/gmail/oauth";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type AccountRow = {
  id: string;
  email: string;
  company_id: string;
  status: "active" | "reconnect";
  visibility: "shared" | "private";
  last_synced_at: string | null;
  companies: { name: string } | null;
};

async function loadMailboxes(userId: string): Promise<MailboxView[]> {
  const supabase = await createServerClient();
  // O admin geral lê todas as caixas pelo RLS; aqui só interessam as do próprio usuário.
  const { data } = await supabase
    .from("email_accounts")
    .select("id, email, company_id, status, visibility, last_synced_at, companies(name)")
    .eq("user_id", userId)
    .order("created_at")
    .overrideTypes<AccountRow[], { merge: false }>();
  return (data ?? []).map((a) => ({
    id: a.id,
    email: a.email,
    companyId: a.company_id,
    companyName: a.companies?.name ?? "—",
    status: a.status,
    visibility: a.visibility,
    lastSyncedAt: a.last_synced_at,
  }));
}

async function ProfileContent({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireUser();
  const [params, accounts, companies] = await Promise.all([
    searchParams,
    loadMailboxes(profile.id),
    getAccessibleCompanies(),
  ]);
  const gmail = first(params.gmail);
  const flash: GmailFlash =
    gmail === "ok" ? { gmail: "ok" } : gmail === "erro" ? { gmail: "erro", motivo: first(params.motivo) ?? null } : null;
  const name = profile.fullName || profile.email;
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <div className="grid max-w-2xl gap-6">
      <ProfileForm fullName={profile.fullName} email={profile.email} />
      <AvatarUpload avatarUrl={profile.avatarUrl} initials={initials} />
      <PasswordForm />
      <EmailAccounts
        accounts={accounts}
        companies={companies.map((c) => ({ id: c.id, name: c.name }))}
        configured={gmailConfig() !== null}
        flash={flash}
      />
      <ThemePreference />
    </div>
  );
}

export default function ProfilePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="grid gap-6">
      <h1 className="font-heading text-2xl font-semibold">Perfil</h1>
      <Suspense fallback={null}>
        <ProfileContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
