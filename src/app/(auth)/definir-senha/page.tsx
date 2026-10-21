import { Suspense } from "react";
import { SetPasswordForm } from "@/components/auth/set-password-form";
import { requireUser } from "@/lib/auth/session";

async function Content() {
  await requireUser();
  return <SetPasswordForm />;
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}
