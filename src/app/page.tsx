import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

async function Content() {
  const profile = await requireUser();
  return (
    <div className="grid gap-4">
      <h1 className="font-heading text-2xl font-semibold">Olá, {profile.fullName || profile.email}</h1>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sair
        </Button>
      </form>
    </div>
  );
}

// Provisória: a Task 6 troca esta página pelo shell do app.
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense>
        <Content />
      </Suspense>
    </main>
  );
}
