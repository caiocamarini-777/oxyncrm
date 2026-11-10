import "server-only";
import { gmailConfig } from "@/lib/gmail/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { calendarClientForAccount } from "./google";
import { pushActivity } from "./push";

/**
 * Envio na hora: as ações de atividade chamam `afterActivityWrite` depois de gravar, para o evento na Agenda do
 * vendedor acompanhar sem esperar o cron (a cada 5 min). Fica fora de arquivo `"use server"` de propósito: lá, toda
 * função exportada vira endpoint que qualquer um chama. Aqui só as ações do servidor a importam.
 */

/** Teto de espera da ação: passou disso, ela devolve a resposta e o cron termina o envio. */
export const PUSH_CAP_MS = 8_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Envia a atividade para a Agenda com o cliente admin (a atividade é do dono, mas quem grava é o serviço). Nunca
 * lança e nunca bloqueia a ação por mais de `PUSH_CAP_MS`: erro do banco ou do Google só vai para o log, e a
 * atividade segue pendente para o cron reenviar. Empresa com a Agenda desligada, dono sem caixa e caixa que ainda
 * não fez a primeira rodada voltam `skipped` dentro do `pushActivity`, sem chamar o Google.
 */
export async function afterActivityWrite(activityId: string): Promise<void> {
  // Sem o OAuth do Google não há como falar com a Agenda (a atividade fica pendente, como no cron).
  if (!gmailConfig()) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const push = pushActivity(
      {
        db: createAdminClient(),
        clientFor: calendarClientForAccount,
        now: () => new Date(),
        // Base do link "No CRM" na descrição do evento; sem ela, o evento vai sem o link.
        appUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
      },
      activityId,
    ).then(
      () => true,
      // Já tratado aqui: se o teto vencer antes, a falha tardia não vira rejeição sem dono.
      (e: unknown) => {
        console.error("agenda: falha ao enviar a atividade", activityId, message(e));
        return true;
      },
    );
    const capped = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), PUSH_CAP_MS);
    });
    if (!(await Promise.race([push, capped]))) {
      console.error("agenda: envio da atividade passou do teto; o cron termina", activityId);
    }
  } catch (e) {
    // Falha ao montar o envio (cliente admin sem env, por exemplo): a ação já gravou, o cron reenvia.
    console.error("agenda: falha ao enviar a atividade", activityId, message(e));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
