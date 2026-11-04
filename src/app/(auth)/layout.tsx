import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen flex-1 md:grid-cols-2">
      <aside className="hidden flex-col items-center justify-center gap-6 bg-sidebar p-12 md:flex">
        <Image src="/oxyn-mark.png" alt="Oxyn" width={160} height={160} priority />
        <p className="font-heading text-2xl font-semibold tracking-[0.3em] text-white">
          OXYN CRM
        </p>
      </aside>
      <section className="flex flex-col items-center justify-center gap-10 bg-background p-6">
        <div className="w-full max-w-sm">{children}</div>
        <nav className="flex gap-6 text-xs text-muted-foreground">
          <Link href="/privacidade" className="hover:text-foreground">
            Política de Privacidade
          </Link>
          <Link href="/termos" className="hover:text-foreground">
            Termos de Uso
          </Link>
        </nav>
      </section>
    </main>
  );
}
