import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import type { CompanySummary } from "@/lib/companies/pure";
import { cn } from "cn";

/** Aviso centralizado dos estados especiais do módulo E-mail. */
export function Notice({ title, children, tone = "default" }: { title: string; children?: ReactNode; tone?: "default" | "warning" }) {
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      className={cn("flex flex-col gap-2 rounded-lg border p-4 text-sm", tone === "warning" && "border-amber-500/50 bg-amber-500/10")}
    >
      <p className="font-medium">{title}</p>
      {children ? <div className="flex flex-col gap-2 text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function ProfileLink({ children }: { children: ReactNode }) {
  return (
    <Link href="/perfil" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>
      {children}
    </Link>
  );
}

export function NotConfigured() {
  return (
    <Notice title="Integração com o Gmail ainda não configurada">
      <p>Assim que o administrador cadastrar as credenciais do Google, você poderá conectar sua caixa pelo perfil.</p>
    </Notice>
  );
}

export function NoMailbox() {
  return (
    <Notice title="Você ainda não conectou uma caixa nesta empresa">
      <p>Conecte seu Gmail pelo perfil para ler seus e-mails aqui e vinculá-los a leads, negócios e contatos.</p>
      <ProfileLink>Conectar pelo perfil</ProfileLink>
    </Notice>
  );
}

export function Reconnect({ email }: { email: string }) {
  return (
    <Notice title={`A caixa ${email} precisa ser reconectada`} tone="warning">
      <p>O Google revogou o acesso a esta caixa. Reconecte-a no perfil para voltar a ler e sincronizar os e-mails.</p>
      <ProfileLink>Reconectar pelo perfil</ProfileLink>
    </Notice>
  );
}

/**
 * Caixa sem algum escopo do assistente de reuniões (Meet, agenda ou os arquivos do Meet no Drive) ou da sincronização
 * com a Agenda (gravar eventos).
 */
export function ReconnectForMeet({ companyId }: { companyId: string }) {
  return (
    <Notice title="Reconecte o Google para ativar o assistente de reuniões e a Agenda.">
      <p>
        Esta caixa foi conectada sem algum dos acessos do CRM (reuniões do Meet, Agenda e anotações do Gemini).
        Reconecte-a e autorize os novos acessos.
      </p>
      {/* O perfil só oferece "Reconectar" quando a caixa caiu; aqui ela está ativa, então vai direto ao OAuth. */}
      <a
        href={`/api/google/conectar?empresa=${encodeURIComponent(companyId)}`}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
      >
        Reconectar o Google
      </a>
    </Notice>
  );
}

export function PickCompany({ companies }: { companies: CompanySummary[] }) {
  return (
    <Notice title="Escolha uma empresa para ver seus e-mails">
      <p>As caixas conectadas pertencem a uma empresa. Selecione uma delas no seletor do topo ou abra direto:</p>
      <ul className="flex flex-wrap gap-2">
        {companies.map((c) => (
          <li key={c.id}>
            <Link href={`/${c.slug}/email`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
