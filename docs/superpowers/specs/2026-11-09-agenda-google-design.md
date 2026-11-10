# Agenda do Google nos dois sentidos

Data: 2026-11-09. Parte 2 de 3 da preparação para desligar o Pipedrive (as outras partes: `2026-11-09-importar-emails-arquivos-pipedrive-design.md` e `2026-11-09-reunioes-no-crm-design.md`).

## Objetivo

Hoje a equipe usa a sincronização do Pipedrive com a Agenda do Google. Quando o Pipedrive sair, o CRM precisa fazer o mesmo: atividades do CRM aparecem na Agenda do vendedor, mudanças feitas na Agenda voltam para o CRM, e reunião agendada no CRM convida o cliente com link do Meet.

**Sucesso:** o vendedor agenda, remarca e cancela pelo CRM ou pela Agenda, e os dois lados ficam iguais. O cliente recebe o convite com Meet.

## Decisões do usuário (2026-11-09)

| Tema | Decisão |
|---|---|
| Sentido | **Nos dois sentidos.** |
| Convite | **Reunião agendada no CRM com contato que tem e-mail convida o cliente, com link do Meet.** |
| Evento criado direto na Agenda | **Sempre vira atividade**, mesmo sem cliente, e fica sem vínculo quando nenhum convidado é contato do CRM. |
| Evento apagado ou cancelado na Agenda | **Reunião é concluída como Cancelada** (entra nas métricas). Os outros tipos de atividade vão para a lixeira (30 dias para recuperar). |
| Hoje | A equipe usa a sincronização do Pipedrive com a Agenda. |

## Decisões técnicas (minhas)

- **Liga só na virada.** A sincronização fica desligada por empresa (`companies.settings.calendar_sync.enabled`) até o dia da virada. Enquanto o modo espelho estiver ativo, o Pipedrive sobrescreve as atividades do CRM todo dia e ainda sincroniza a própria Agenda. Ligar antes duplicaria eventos.
- **Mesma conexão Google.** O escopo `calendar.events.readonly` vira `https://www.googleapis.com/auth/calendar.events` (ler e escrever eventos). Todo mundo reconecta uma vez, o que convém fazer antes da virada. A Agenda usada é a principal (`primary`) da conta conectada.
- **Qual conta recebe a atividade:** a caixa do dono da atividade na mesma empresa da atividade. Sem caixa nessa empresa, vale a caixa dele em qualquer empresa, a mais antiga. Sem nenhuma caixa, a atividade não sincroniza.
- **Saída (CRM → Agenda):**
  - Um gatilho no banco marca a atividade como pendente (`calendar_state = 'pending'`) quando muda algo que aparece no evento: assunto, descrição, horário, duração, conclusão, lixeira, dono ou contato.
  - As server actions do CRM enviam na hora, depois de gravar, para o convite sair na hora.
  - O cron reenvia o que ficou pendente.
- **Entrada (Agenda → CRM):** sincronização incremental com `syncToken` (`events.list`), num cron a cada 5 minutos. Um 410 (token vencido) recomeça a partir de agora, sem reimportar o passado.
- **Sem eco:**
  - Todo evento criado pelo CRM leva `extendedProperties.private.oxynActivityId`.
  - A atividade guarda `calendar_event_id` e o `etag` da última escrita. Na entrada, um evento com o mesmo `etag` que o CRM gravou é ignorado.
  - A entrada grava com uma marca de sessão (`oxyn.calendar_inbound`) que impede o gatilho de marcar a atividade como pendente de novo.
- **Conflito:** quando os dois lados mudaram entre duas rodadas, vale a mudança mais recente (`activities.updated_at` × `event.updated`).
- **Cron:** `/api/cron/agenda` a cada 5 min, com `maxDuration` de 300 s e um lease por caixa (`email_accounts.calendar_lock_until`). Entra em `SELF_AUTH`, e depois do deploy a rota é conferida com curl (401).

## Modelo de dados

| Onde | Campos novos |
|---|---|
| `activities` | `source` (`crm`, `pipedrive`, `google_calendar`; padrão `crm`, e as importadas recebem `pipedrive`), `calendar_account_id` → email_accounts, `calendar_event_id`, `calendar_etag`, `calendar_state` (`none`, `pending`, `synced`, `error`), `calendar_error`, `meet_url` |
| `activities` (regra) | A exigência de vínculo passa a ser: lead, negócio, pessoa ou organização, **ou** `source = 'google_calendar'`. Assim o evento sem cliente vira atividade sem vínculo. A visibilidade da atividade continua pela empresa e pelo dono (papéis), como hoje. |
| `email_accounts` | `calendar_sync_token`, `calendar_lock_until`, `calendar_since` (início da sincronização da caixa) |
| `companies.settings.calendar_sync` | `{enabled: bool, enabled_at}` |

## Saída: CRM → Agenda

| Atividade no CRM | Evento na Agenda |
|---|---|
| Criada ou alterada, aberta | Cria ou atualiza o evento:<br>- título = assunto;<br>- descrição = descrição + link do registro no CRM;<br>- início = `due_at`, fim = início + duração (duração 0 vira 15 min);<br>- lembrete padrão da Agenda. |
| Reunião com pessoa que tem e-mail | Convida a pessoa (`sendUpdates=all`) e cria o link do Meet (`conferenceData.createRequest`). O link fica em `meet_url` e aparece na atividade ("Entrar no Meet"). |
| Remarcada (novo horário) | Atualiza o evento e avisa os convidados. |
| Concluída | O evento fica como está, como histórico. Se a reunião for concluída como **Cancelada**, o evento é apagado e os convidados são avisados. Se for **Remarcada**, a nova reunião criada pela conclusão gera um evento novo. |
| Na lixeira | Apaga o evento (avisa os convidados, se houver). Ao restaurar, recria. |
| Dono trocado | Apaga da Agenda do dono antigo e cria na do novo. |

## Entrada: Agenda → CRM

| Evento na Agenda | Atividade no CRM |
|---|---|
| Ligado a uma atividade, com horário ou título mudado | Atualiza `due_at`, a duração e o assunto. |
| Ligado a uma atividade e apagado ou cancelado | Reunião: concluída com resultado **Cancelada**. Outros tipos: vão para a lixeira. |
| Novo, criado direto na Agenda | Vira atividade com `source = google_calendar`:<br>- dono = dono da caixa, empresa = empresa da caixa;<br>- tipo **Reunião** quando tem outros convidados ou link de reunião, senão **Tarefa**;<br>- canal **Videochamada** com link de reunião, **Presencial** com local e sem link, senão **Não informado**;<br>- vínculo pelo mesmo casador do assistente de reuniões (convidado que é contato do CRM → negócio aberto, lead ou pessoa), senão sem vínculo. |
| Evento marcado como particular na Agenda | Entra como "Ocupado", sem descrição e sem convidados. |
| Recorrente | Cada ocorrência vira uma atividade, mas só quando faltam até 7 dias para ela. Isso evita encher o CRM com meses de reuniões semanais. |

**Fica de fora:**
- eventos recusados pelo vendedor;
- eventos de dia inteiro: o CRM não tem atividade sem horário, e na prática são feriados, ausências e aniversários;
- eventos dos tipos "Fora do escritório", "Tempo de foco" e "Local de trabalho";
- eventos que começaram antes de a sincronização ser ligada.

Como todo evento vira atividade, compromissos pessoais do vendedor ficam visíveis para quem enxerga as atividades dele no CRM, conforme o papel. O evento marcado como particular na Agenda é a proteção: entra só como "Ocupado".

## Ligar na virada (ordem)

1. Cada vendedor desliga a sincronização de agenda no Pipedrive.
2. O admin liga a sincronização da Agenda na empresa, em Configurações.
3. A primeira rodada de cada caixa:
   - **Adota** os eventos que o Pipedrive deixou: para cada atividade aberta do vendedor com horário a partir de agora, procura um evento no mesmo horário e com o mesmo título e passa a usá-lo, sem criar outro.
   - Cria os eventos que faltam **sem convidar ninguém**, para o cliente não receber de novo o convite de uma reunião que já existia.
   - Daí em diante, só as reuniões criadas ou remarcadas no CRM convidam.
4. A entrada começa a contar a partir desse momento (`calendar_since`).

## Interface

- **Formulário de atividade:** quando o tipo é reunião e a pessoa tem e-mail, aparece o aviso "O cliente recebe o convite com link do Meet".
- **Atividade:**
  - mostra "Entrar no Meet" quando há `meet_url`;
  - mostra "Agenda: não foi possível atualizar" quando `calendar_state = 'error'`, com "Tentar de novo".
- **Configurações:** "Sincronizar com a Agenda do Google", por empresa, só para o admin geral. O texto explica a ordem da virada.
- **E-mail (conexão Google):** o aviso de reconexão passa a citar a Agenda.

## Assistente de reuniões

A atividade com `calendar_event_id` passa a ser a âncora exata da reunião do Meet (o evento tem o código da reunião). O casador por horário continua para as reuniões que não nasceram no CRM.

## Erros

| Situação | Comportamento |
|---|---|
| Token inválido | A caixa vai para "reconectar", como no Gmail, e as atividades ficam pendentes até a reconexão. |
| Falha ao gravar o evento | `calendar_state = 'error'` com a mensagem. O cron tenta de novo até 3 vezes; depois, só pelo "Tentar de novo". |
| Limite de uso do Google (403/429) | Para a rodada da caixa e retoma na próxima. |
| 410 no `syncToken` | Recomeça a entrada a partir de agora. |
| Evento ligado a uma atividade apagada de vez | O vínculo é desfeito e o evento é tratado como novo, conforme as regras acima. |
| Evento cancelado cuja atividade já está concluída ou na lixeira | Ignorado (é o eco do próprio CRM apagando o evento). |

## Testes

- **Saída:** do formato da atividade para o evento (título, descrição, horários, duração 0, convidados e Meet só para reunião com e-mail).
- **Entrada:**
  - do evento para a atividade (tipo, canal, particular, vínculo pelo casador);
  - o que fica de fora (recusado, dia inteiro, tipos especiais, recorrente além de 7 dias).
- **Ciclo:**
  - sem eco (o mesmo `etag` não volta);
  - conflito pela mudança mais recente;
  - apagar na Agenda conclui a reunião como Cancelada e manda as outras atividades para a lixeira;
  - lixeira e dono trocado no CRM.
- **Virada:** adoção por horário e título; eventos criados sem convite na primeira rodada.
- **Cron:** lease por caixa, 410, token inválido e limite de uso, com cliente do Google simulado.
- **Banco:** atividade sem vínculo só com `source = 'google_calendar'`; o gatilho de pendente não dispara durante a entrada.
