import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { Composer } from "@/components/email/composer";
import { CreatePersonFromSender } from "@/components/email/create-person-dialog";
import { LinkThreadDialog } from "@/components/email/link-thread-dialog";
import { MessageView } from "@/components/email/message-view";
import { NotConfigured, Notice, Reconnect } from "@/components/email/mailbox-states";
import { ThreadLinkChips } from "@/components/email/thread-link-chips";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { getAccessibleCompanies, resolveCompanyScope } from "@/lib/companies/scope";
import { clientForAccount } from "@/lib/gmail/accounts";
import { buildTemplateVars, replyRecipients } from "@/lib/gmail/compose";
import { getCompanyTemplates } from "@/lib/gmail/compose-data";
import { classifyGmailError, getThreadLinks, knownPersonEmails, LIVE_ERROR_TEXT, listMyMailboxes } from "@/lib/gmail/live";
import { externalSenders, mailboxHref, suggestedPersonName, toMessageView, visibleMessages } from "@/lib/gmail/live-thread";
import { gmailConfig } from "@/lib/gmail/oauth";
import { parseGmailMessage } from "@/lib/gmail/parse";
import { cn } from "cn";

export const instant = false;

const GMAIL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EmailThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const [{ empresa, threadId }, sp, profile, companies] = await Promise.all([params, searchParams, requireUser(), getAccessibleCompanies()]);
  const scope = resolveCompanyScope(empresa, companies, profile.isSuperAdmin);
  if (!scope || scope.kind !== "company") notFound();
  const caixa = Array.isArray(sp.caixa) ? sp.caixa[0] : sp.caixa;
  if (!GMAIL_ID.test(threadId) || !caixa || !UUID.test(caixa)) notFound();

  const company = scope.company;
  const mailbox = (await listMyMailboxes(profile.id, company.id)).find((m) => m.id === caixa);
  if (!mailbox) notFound();

  const back = (
    <Link href={mailboxHref(`/${empresa}/email`, { caixa: mailbox.id })} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}>
      <ArrowLeft /> Voltar para a caixa
    </Link>
  );
  const wrap = (body: React.ReactNode) => (
    <div className="flex flex-col gap-4">
      {back}
      {body}
    </div>
  );

  if (!gmailConfig()) return wrap(<NotConfigured />);
  if (mailbox.status === "reconnect") return wrap(<Reconnect email={mailbox.email} />);

  let messages;
  try {
    messages = visibleMessages((await clientForAccount(mailbox.id).getThread(threadId, "full")).messages);
  } catch (e) {
    const kind = classifyGmailError(e);
    if (kind === "reconnect") return wrap(<Reconnect email={mailbox.email} />);
    return wrap(
      <Notice title="Não foi possível carregar a conversa" tone="warning">
        <p>{LIVE_ERROR_TEXT[kind]}</p>
      </Notice>,
    );
  }
  if (messages.length === 0) return wrap(<Notice title="Esta conversa não tem mensagens para mostrar." />);

  const views = messages.map((m) => toMessageView(parseGmailMessage(m), mailbox.email));
  const subject = views.length > 0 ? (parseGmailMessage(messages[0]).subject.trim() || "(sem assunto)") : "(sem assunto)";
  const senders = externalSenders(views, mailbox.email);
  const [links, known, templates] = await Promise.all([
    getThreadLinks(mailbox.id, threadId),
    knownPersonEmails(company.id, senders.map((s) => s.email)),
    getCompanyTemplates(company.id),
  ]);
  const unknownSenders = senders.filter((s) => !known.has(s.email));

  return wrap(
    <>
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-2xl font-semibold break-words">{subject}</h1>
        <p className="text-sm text-muted-foreground">
          Caixa {mailbox.email} · {views.length} {views.length === 1 ? "mensagem" : "mensagens"}
        </p>
        <ThreadLinkChips links={links} companySlug={company.slug} />
        <div className="flex flex-wrap items-center gap-2">
          <LinkThreadDialog accountId={mailbox.id} companyId={company.id} gmailThreadId={threadId} />
          {unknownSenders.map((s) => (
            <CreatePersonFromSender
              key={s.email}
              accountId={mailbox.id}
              gmailThreadId={threadId}
              initialName={suggestedPersonName(s)}
              email={s.email}
            />
          ))}
          <Composer
            label="Responder"
            mailboxes={[{ id: mailbox.id, email: mailbox.email }]}
            initialAccountId={mailbox.id}
            initialTo={replyRecipients(views)}
            initialSubject={subject === "(sem assunto)" ? "" : subject}
            templates={templates}
            vars={buildTemplateVars({ personName: senders[0] ? suggestedPersonName(senders[0]) : null, userName: profile.fullName })}
            reply={{ gmailThreadId: threadId, replyToGmailMessageId: messages[messages.length - 1].id }}
          />
        </div>
      </header>
      <section className="flex flex-col gap-3" aria-label="Mensagens">
        {views.map((m) => (
          <MessageView key={m.id} message={m} subject={subject} />
        ))}
      </section>
    </>,
  );
}
