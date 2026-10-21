import { Suspense } from "react";
import { AvatarUpload } from "@/components/profile/avatar-upload";
import { PasswordForm } from "@/components/profile/password-form";
import { ProfileForm } from "@/components/profile/profile-form";
import { ThemePreference } from "@/components/profile/theme-preference";
import { requireUser } from "@/lib/auth/session";

export const instant = false;

async function ProfileContent() {
  const profile = await requireUser();
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
      <ThemePreference />
    </div>
  );
}

export default function ProfilePage() {
  return (
    <div className="grid gap-6">
      <h1 className="font-heading text-2xl font-semibold">Perfil</h1>
      <Suspense fallback={null}>
        <ProfileContent />
      </Suspense>
    </div>
  );
}
