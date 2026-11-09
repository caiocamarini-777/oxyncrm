import { Suspense } from "react";
import { SettingsCompanyPicker, NoCompany } from "@/components/settings/company-picker";
import { MeetingAssistantForm } from "@/components/settings/meeting-assistant-form";
import { requireSuperAdmin } from "@/lib/auth/session";
import { resolveSettingsCompany } from "@/lib/companies/settings-company";
import { readMeetingSettings } from "@/lib/meet/settings";
import { fail } from "@/lib/records/list-helpers";
import { createServerClient } from "@/lib/supabase/server";

export const instant = false;

export default async function MeetingAssistantSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  await requireSuperAdmin();
  const { empresa } = await searchParams;
  const { companies, selected } = await resolveSettingsCompany(empresa);
  if (!selected) return <NoCompany />;
  const supabase = await createServerClient();
  const company = await supabase.from("companies").select("settings").eq("id", selected.id).single();
  if (company.error) fail("configurações", "empresa", company.error);
  const { enabled, questions } = readMeetingSettings(company.data.settings);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold">Assistente de reuniões</h1>
        <Suspense>
          <SettingsCompanyPicker companies={companies} selected={selected.slug} />
        </Suspense>
      </div>
      <p className="text-sm text-muted-foreground">
        Depois de cada reunião do Google Meet com convidado externo, o assistente lê a transcrição (ou, quando a
        reunião não teve transcrição, as anotações do Gemini), escreve as notas e sugere atualizações no registro.
        Para não depender de lembrar na hora, ligue &quot;Fazer anotações com o Gemini&quot; ao criar o evento na
        Agenda. A configuração vale para a empresa selecionada. Com o assistente ligado,
        cada vendedor precisa reconectar o Google uma vez pelo aviso que aparece no módulo E-mail da empresa, para o
        assistente enxergar as reuniões dele.
      </p>
      <MeetingAssistantForm key={selected.id} companyId={selected.id} enabled={enabled} questions={questions} />
    </div>
  );
}
