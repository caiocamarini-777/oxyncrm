# Piloto de 15 dias com o Pipedrive atualizado pelo CRM

Durante o piloto o CRM é a origem dos dados e o Pipedrive recebe uma cópia: de hora em hora, o workflow
`Pipedrive atualizado pelo CRM` (`.github/workflows/pipedrive-backup.yml`) copia para lá o que foi criado, mudado ou
apagado no CRM (organizações, pessoas, leads, negócios, atividades e anotações). Exclusões também são apagadas no Pipedrive.

1. **Ligar.** Só depois da sincronização final sem espelho (`pnpm sync:pipedrive`, sem `--espelho`):
   - rode `pnpm sync:crm-para-pipedrive --ligar`. Os cursores começam no início dessa sincronização, então o que
     entrou no CRM durante ela e depois dela também vai;
   - ligue a variável do repositório que deixa o workflow rodar: `gh variable set PIPEDRIVE_BACKUP --body on`. Sem ela
     em `on`, o job nem começa (fora do piloto, não gasta minutos do Actions).

   A rotina não roda enquanto a última importação concluída do Pipedrive for um job espelho dos últimos 48 h: a rodada
   sai como `skipped` e nada é enviado. Com a rotina ligada, `pnpm sync:pipedrive` se recusa a rodar (sai com código 1):
   as duas direções juntas apagariam dados. Desligue a sincronização diária (`sync-pipedrive.yml`) no mesmo dia.
2. **No Pipedrive, durante o piloto:**
   - **o usuário do token mantém a escrita** (admin). Sem permissão de escrita, as rodadas falham (403) e nada chega
     ao Pipedrive;
   - os outros usuários, se o plano permitir, ficam só com leitura. Qualquer edição feita lá é sobrescrita na próxima
     mudança do mesmo registro no CRM;
   - **desligue as automações e os webhooks**: as mudanças enviadas pelo CRM (etapa, status, dono) disparariam esses
     fluxos de novo, inclusive e-mails para clientes;
   - **desligue a sincronização com o Google Agenda**: ela é de mão dupla e, junto com a Agenda do CRM, duplicaria
     atividades.
3. **Funil e etapa novos.** Funis e etapas criados no CRM durante o piloto precisam ser criados também no Pipedrive,
   do mesmo jeito que existem lá. Negócio em etapa sem correspondente no Pipedrive não é enviado: vira erro do registro
   e entra na fila de retry. Etapa do CRM que veio de mais de uma etapa do Pipedrive (funis juntados) vai para a
   primeira na ordem do funil, com um aviso no relatório da rodada.
4. **Conferir.** `pnpm sync:crm-para-pipedrive --status` mostra se a rotina está ligada, os cursores de cada tipo de
   registro, a última rodada (contadores, erros e avisos) e a fila de retry.
   - Erro de um registro (o Pipedrive recusou os dados): o registro tenta até 5 vezes, uma por rodada; depois sai da
     fila e fica só no relatório da rodada (`pipedrive_push_runs`).
   - Falha geral do Pipedrive (fora do ar, rede, cota, 403): a rodada para como `failed`, o workflow fica vermelho e
     nada se perde. A rodada seguinte tenta de novo do mesmo ponto.
5. **Limitações conhecidas.**
   - Se o mesmo registro do Pipedrive foi importado para duas empresas do CRM e uma delas o manda para a lixeira, ele é
     apagado no Pipedrive para as duas.
   - Se a criação de um registro no Pipedrive cair por tempo ou erro do servidor depois de o Pipedrive já ter criado
     o registro, a rodada seguinte cria de novo, e ele fica duplicado lá. Apague o duplicado no Pipedrive à mão.
6. **Fim do piloto.** Rode `pnpm sync:crm-para-pipedrive --desligar` e desligue a variável
   (`gh variable set PIPEDRIVE_BACKUP --body off`). Depois, faça a exportação completa do Pipedrive e cancele a
   assinatura.
