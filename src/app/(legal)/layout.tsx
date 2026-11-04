import Image from "next/image";
import Link from "next/link";

// Páginas públicas exigidas pela tela de consentimento do Google (sem sessão; liberadas no proxy).
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="bg-sidebar">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-5">
          <Image src="/oxyn-mark.png" alt="Oxyn" width={32} height={32} />
          <span className="font-heading text-sm font-semibold tracking-[0.3em] text-white">OXYN CRM</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
      <footer className="border-t">
        <nav className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
          <Link href="/privacidade" className="hover:text-foreground">
            Política de Privacidade
          </Link>
          <Link href="/termos" className="hover:text-foreground">
            Termos de Uso
          </Link>
          <Link href="/entrar" className="hover:text-foreground">
            Entrar no CRM
          </Link>
        </nav>
      </footer>
    </div>
  );
}
