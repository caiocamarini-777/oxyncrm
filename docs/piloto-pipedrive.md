# Piloto de 15 dias com o Pipedrive atualizado pelo CRM

Durante o piloto o CRM é a origem dos dados e o Pipedrive recebe uma cópia: de hora em hora, o workflow
`Pipedrive atualizado pelo CRM` (`.github/workflows/pipedrive-backup.yml`) copia para lá o que foi criado, mudado ou
apagado no CRM (organizações, pessoas, leads, negócios, atividades e anotações). Exclusões também são apagadas no Pipedrive.

1. **Ligar.** Só depois da sincronização final sem espelho (`pnpm sync:pipedrive`, sem `--espelho`), rode
   `pnpm sync:crm-para-pipedrive --ligar`. O cursor começa no fim dessa sincronização, então o que mudou no CRM depois dela
   também vai. A rotina não roda enquanto a última importação concluída do Pipedrive for um job espelho dos últimos 48 h:
   a rodada sai como `skipped` e nada é enviado.
2. **Pipedrive só para leitura.** Se o plano permitir, deixe os usuários do Pipedrive só com leitura. Qualquer edição
   feita lá é sobrescrita na próxima mudança do mesmo registro no CRM.
3. **Funil e etapa novos.** Funis e etapas criados no CRM durante o piloto precisam ser criados também no Pipedrive,
   do mesmo jeito que existem lá. Negócio em etapa sem correspondente no Pipedrive não é enviado: vira erro do registro
   e entra na fila de retry.
4. **Conferir.** `pnpm sync:crm-para-pipedrive --status` mostra se a rotina está ligada, o cursor, a última rodada
   (contadores e erros) e a fila de retry. Cada registro tenta até 5 vezes; depois sai da fila e fica só no relatório da
   rodada (`pipedrive_push_runs`).
5. **Limitação conhecida.** Se o mesmo registro do Pipedrive foi importado para duas empresas do CRM e uma delas o manda
   para a lixeira, ele é apagado no Pipedrive para as duas.
6. **Fim do piloto.** Rode `pnpm sync:crm-para-pipedrive --desligar` (ou desative o workflow), faça a exportação completa
   do Pipedrive e cancele a assinatura.
