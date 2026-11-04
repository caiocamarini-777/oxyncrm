/** Blocos de texto das páginas legais, com a tipografia do CRM. */
export function LegalTitle({ title, updated }: { title: string; updated: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-heading text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Última atualização: {updated}</p>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 space-y-3 text-[15px] leading-relaxed [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
      <h2 className="font-heading text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export const LEGAL_CONTACT = "comercial@oxyngroup.com.br";
export const LEGAL_UPDATED = "4 de novembro de 2026";
