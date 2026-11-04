import { Suspense } from "react";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Search } from "lucide-react";
import { Notice, NoMailbox, NotConfigured, PickCompany, Reconnect } from "@/components/email/mailbox-states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { LIVE_ERROR_TEXT, listMyMailboxes, loadLivePage, type Mailbox } from "@/lib/gmail/live";
import { cleanPageToken, cleanQuery, mailboxHref } from "@/lib/gmail/live-thread";
import { gmailConfig } from "@/lib/gmail/oauth";
import { formatDate } from "@/lib/records/format";
import { cn } from "cn";

export const instant = false;

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await connection();
  const [{ empresa }, sp, profile, companies] = await Promise.all([params, searchParams, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope) notFound();

  const heading = <h1 className="font-heading text-2xl font-semibold">E-mail</h1>;
  const wrap = (body: React.ReactNode) => (
    <div className="flex flex-col gap-4">
      {heading}
      {body}
    </div>
  );

  if (scope.kind === "all") return wrap(<PickCompany companies={companies} />);
  if (!gmailConfig()) return wrap(<NotConfigured />);

  const mailboxes = await listMyMailboxes(profile.id, scope.company.id);
  if (mailboxes.length === 0) return wrap(<NoMailbox />);

  const wanted = first(sp.caixa);
  const mailbox = mailboxes.find((m) => m.id === wanted) ?? mailboxes[0];
  const q = cleanQuery(first(sp.q));
  const pageToken = cleanPageToken(first(sp.pagina));
  const base = `/${empresa}/email`;

  return wrap(
    <>
      {mailboxes.length > 1 ? (
        <nav aria-label="Caixas" className="flex flex-wrap gap-2">
          {mailboxes.map((m) => (
            <Link
              key={m.id}
              href={mailboxHref(base, { caixa: m.id })}
              aria-current={m.id === mailbox.id ? "page" : undefined}
              className={cn(buttonVariants({ variant: m.id === mailbox.id ? "default" : "outline", size: "sm" }))}
            >
              {m.email}
            </Link>
          ))}
        </nav>
      ) : (
        <p className="text-sm text-muted-foreground">{mailbox.email}</p>
      )}
      {mailbox.status === "reconnect" ? (
        <Reconnect email={mailbox.email} />
      ) : (
        <>
          <Form action={base} className="flex gap-2">
            <input type="hidden" name="caixa" value={mailbox.id} />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Buscar no Gmail (ex.: from:ana@cliente.com has:attachment)"
              aria-label="Buscar no Gmail"
              maxLength={200}
            />
            <Button type="submit" variant="outline">
              <Search /> Buscar
            </Button>
          </Form>
          <Suspense key={`${mailbox.id}|${q}|${pageToken ?? ""}`} fallback={<p className="text-sm text-muted-foreground">Carregando e-mails…</p>}>
            <LiveList empresa={empresa} mailbox={mailbox} q={q} pageToken={pageToken} />
          </Suspense>
        </>
      )}
    </>,
  );
}

async function LiveList({ empresa, mailbox, q, pageToken }: { empresa: string; mailbox: Mailbox; q: string; pageToken: string | null }) {
  const page = await loadLivePage(mailbox, q, pageToken);
  const base = `/${empresa}/email`;
  if (!page.ok) {
    if (page.error === "reconnect") return <Reconnect email={mailbox.email} />;
    return (
      <Notice title="Não foi possível carregar os e-mails" tone="warning">
        <p>{LIVE_ERROR_TEXT[page.error]}</p>
        <Link href={mailboxHref(base, { caixa: mailbox.id, q })} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>
          Tentar de novo
        </Link>
      </Notice>
    );
  }

  const pager = (
    <div className="flex items-center justify-end gap-2">
      {pageToken ? (
        <Link href={mailboxHref(base, { caixa: mailbox.id, q })} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Voltar ao início
        </Link>
      ) : null}
      {page.nextPageToken ? (
        <Link
          href={mailboxHref(base, { caixa: mailbox.id, q, pagina: page.nextPageToken })}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Mais antigos
        </Link>
      ) : null}
    </div>
  );

  if (page.rows.length === 0) {
    return (
      <>
        <p className="text-sm text-muted-foreground">{q ? "Nenhuma conversa encontrada para esta busca." : "Nenhuma conversa nesta caixa."}</p>
        {pageToken ? pager : null}
      </>
    );
  }
  return (
    <>
      <ul className="flex flex-col divide-y rounded-lg border bg-card" data-testid="email-live-list">
        {page.rows.map((t) => (
          <li key={t.gmailThreadId}>
            <Link
              href={mailboxHref(`${base}/${t.gmailThreadId}`, { caixa: mailbox.id })}
              className="flex flex-col gap-0.5 px-3 py-2.5 hover:bg-muted/50"
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">
                  {t.sender || "(desconhecido)"}
                  {t.messageCount > 1 ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{t.messageCount}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(t.lastAt)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="truncate text-sm">{t.subject.trim() || "(sem assunto)"}</span>
                {t.linked ? (
                  <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">Vinculado</span>
                ) : null}
              </span>
              {t.snippet ? <span className="truncate text-xs text-muted-foreground">{t.snippet}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {pager}
    </>
  );
}
