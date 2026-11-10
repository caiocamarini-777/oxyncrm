# Virada do Pipedrive para o CRM

Roteiro do dia em que o CRM deixa de copiar o Pipedrive e passa a ser a origem dos dados. É a fonte única da ordem: as specs de cada parte (`docs/superpowers/specs/2026-11-09-*`) explicam o porquê.

Os comandos `pnpm` rodam na raiz do projeto, com o `.env.local` apontando para produção (`PIPEDRIVE_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`). Comece cedo: a rotina diária do Pipedrive roda às 9h (Brasília) e o passo 5 precisa acontecer antes da próxima rodada.

## Antes do dia

1. **Supabase Pro** (recomendado): ligue o plano com backup diário antes da virada. Depois dela, o banco do CRM é o único lugar com os dados novos.
2. **Google com o acesso à Agenda:** cada vendedor reconecta a conta Google no CRM (Perfil → E-mail → Reconectar; o módulo E-mail leva até lá) e autoriza os novos acessos, entre eles o de editar eventos (`calendar.events`). Dá para fazer nos dias anteriores.

## No dia

1. **Congelar o Pipedrive:** avise a equipe que ninguém cria nem edita nada no Pipedrive a partir de agora.
2. **Última sincronização espelho:** rode Actions → Sincronização Pipedrive → Run workflow (ou `pnpm sync:pipedrive --espelho` e `pnpm import:pipedrive-etapas`). Espere terminar com `Status: done`.
3. **Uma sincronização SEM `--espelho`:** `pnpm sync:pipedrive` e `pnpm import:pipedrive-etapas`. Ela não traz nada de novo, mas vira a última importação concluída, e a trava do assistente de reuniões (espelho nas últimas 48 h) libera na hora.
4. **Última importação de e-mails e arquivos:** `pnpm import:pipedrive-arquivos`. Ela traz o que chegou desde a primeira carga e pode ser repetida se parar no meio.
5. **Desligar a rotina diária:** em `.github/workflows/sync-pipedrive.yml`, tire o `--espelho` e o bloco `schedule` e leve o commit ao `main`. Até ele chegar lá, desligue em Actions → Sincronização Pipedrive → Disable workflow. Se ela rodar com `--espelho` depois da virada, manda para a lixeira o que foi criado só no CRM.
6. **Assistente de reuniões no CRM:** na Vercel, defina `MEETING_SINK=crm` (Production) e publique de novo (Redeploy). A partir daí, a anotação e as sugestões confirmadas vão para o CRM, e nada vai para o Pipedrive.
7. **Agenda:** cada vendedor desliga a sincronização de agenda no Pipedrive.
8. **Ligar a Agenda no CRM:** o admin geral liga, empresa por empresa, em Configurações → Agenda do Google → "Sincronizar com a Agenda do Google". Na primeira rodada o CRM adota os eventos que já existem e não reenvia convites.
9. **Conferir as rotas do cron:** sem o segredo, todas respondem 401.

   ```sh
   for r in lembretes gmail meet agenda; do
     curl -s -o /dev/null -w "$r %{http_code}\n" https://crm.oxyngroup.com.br/api/cron/$r
   done
   ```

10. **Exportação completa do Pipedrive:** exporte todos os dados pelo próprio Pipedrive e guarde o arquivo. É a cópia de segurança fora do CRM.

## Depois

1. **Cópia de segurança no Pipedrive:** quando o PR da sincronização do CRM para o Pipedrive estiver no ar, ligue-a com `pnpm sync:crm-para-pipedrive --ligar`. Esse passo depende daquele PR.
2. **Piloto de 15 dias:** a equipe usa só o CRM. Se algo der errado, o Pipedrive ainda está lá, com a cópia.
3. **Cancelar o Pipedrive:** ao fim do piloto, primeiro `pnpm sync:crm-para-pipedrive --desligar`, depois cancele a assinatura. O `PIPEDRIVE_API_TOKEN` pode sair da Vercel: com `MEETING_SINK=crm`, o assistente de reuniões funciona sem ele.
