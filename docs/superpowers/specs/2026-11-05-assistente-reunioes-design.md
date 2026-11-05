# Assistente de reuniões (Google Meet) no Oxyn CRM

Data: 2026-11-05. Primeira versão de um assistente que transforma reuniões do Google Meet em notas e atualizações de funil. Depois a capacidade será ampliada.

## Objetivo

Quando um vendedor termina uma reunião com cliente ou prospect pelo Google Meet, o assistente lê a transcrição, escreve a anotação da reunião e sugere as atualizações do funil, sem o vendedor precisar digitar nada. A v1 resolve, nesta ordem de importância igual:

1. **Poupar o vendedor:** a anotação (resumo, dores, objeções, próximos passos) sai pronta.
2. **Funil em dia:** a reunião fica concluída com o resultado certo, e a próxima atividade, agendada.
3. **Visibilidade da gestão:** dá para ver o que foi falado em cada reunião, sem perguntar ao vendedor.
4. **Qualificação padronizada:** toda reunião responde ao mesmo roteiro de perguntas da empresa.

## Decisões do usuário (2026-11-05)

| Tema | Decisão |
|---|---|
| Destino até o desligamento do Pipedrive | **Escrever no Pipedrive.** O modo espelho desfaz o que for gravado direto no CRM, então as notas e atividades vão para o Pipedrive pela API, e a sincronização das 9h as traz para o CRM. Depois do desligamento, o destino passa a ser o CRM. |
| Revisão | **A anotação vai direto. O funil espera confirmação.** Resultado da reunião, próxima atividade e etapa viram sugestões que o vendedor confirma no CRM. Sugestão sem resposta em 24 h aparece como pendente para a gestão. |
| Qualificação | **Roteiro por empresa**, configurável no CRM, com um padrão: dor, orçamento, decisor, prazo, concorrentes e próximo passo. |
| Convidados fora do CRM | **Pedir para vincular.** As notas ficam prontas numa lista de "Reuniões sem vínculo", e o vendedor escolhe o registro. Reuniões só com gente interna são ignoradas. |
| Transcrição | **Guardada no CRM**, visível no card para quem tem acesso ao registro. |
| Plano do Workspace | Business Standard (conferido pelo usuário). Tem transcrição do Meet. |

## Decisões técnicas (minhas, registradas)

- **Fonte:** API REST do Google Meet (`conferenceRecords`, `transcripts`, `transcripts.entries`) e API da Agenda (`events.list`), consultadas por um cron. Não há bot entrando na reunião. Avisos em tempo real (Workspace Events API com Pub/Sub) ficam para uma versão futura.
- **Mesma conexão Google do Gmail.** A conta conectada em `email_accounts` ganha os escopos `https://www.googleapis.com/auth/meetings.space.readonly` e `https://www.googleapis.com/auth/calendar.events.readonly`. Quem já está conectado precisa reconectar uma vez. A reunião herda a empresa da caixa, já que é uma empresa por caixa.
- **Cron em `/api/cron/meet`** a cada 10 minutos, com `maxDuration` 300. Entra em `SELF_AUTH` no proxy e é conferido em produção com curl (401, não 307).
- **Claude pela API**, com o cliente REST via `fetch` e sem SDK, no mesmo estilo do cliente do Gmail. O modelo é `claude-sonnet-5-5`, com saída em JSON validada por zod. A chave fica em `ANTHROPIC_API_KEY`.
- **Escrita no Pipedrive** com `PIPEDRIVE_API_TOKEN`, a mesma chave da sincronização. A autoria vai pelo `user_id` do Pipedrive do vendedor, obtido do mapa de usuários da última importação (`mappings.users`, ao contrário). Usa `POST /v1/notes`, `PUT /v1/activities/{id}`, `POST /v1/activities` e `PUT /v1/deals/{id}`.
- **Destino trocável:** a gravação passa por uma interface `MeetingSink` com duas implementações, `pipedriveSink` (agora) e `crmSink` (depois do desligamento). A escolha fica em `MEETING_SINK=pipedrive|crm`, com padrão `pipedrive`.
- **Tabelas próprias** (`meetings` e afins). A limpeza do modo espelho não mexe nelas, porque só cuida de anotações, atividades, negócios, leads, pessoas e organizações.
- **Domínios internos:** os domínios dos e-mails dos usuários do CRM (`profiles.email`). Um convidado é externo se o domínio dele não está nessa lista.

## Modelo de dados

| Tabela | Campos |
|---|---|
| `meetings` | id, company_id, account_id → email_accounts (quem trouxe a reunião), owner_id → profiles (o vendedor), conference_record text (único global: chave de idempotência), calendar_event_id, title, started_at, ended_at, attendees jsonb (`{email, name, internal}`), status (`waiting_transcript`, `processing`, `unlinked`, `done`, `failed`, `ignored`), attempts int, last_error, entity (`deals`, `leads`, `persons`, `organizations`, nulo enquanto sem vínculo), record_id, anchor_activity_id (reunião agendada encontrada), created_at, updated_at |
| `meeting_transcripts` | meeting_id (pk, cascade), entries jsonb (`{speaker, text, start}`), text (transcrição corrida, até 1 MB) |
| `meeting_notes` | meeting_id (pk, cascade), summary, pains jsonb, objections jsonb, qualification jsonb (`{question, answer}`), next_steps jsonb (`{what, owner, due}`), model, raw jsonb (resposta validada), pipedrive_note_id, written_at |
| `meeting_suggestions` | id, meeting_id (cascade), kind (`meeting_outcome`, `next_activity`, `stage`), payload jsonb, status (`pending`, `confirmed`, `dismissed`, `failed`), decided_by, decided_at, last_error |
| `email_accounts.meeting_cursor` | timestamptz: fim da última reunião já lida pela conta (coluna nova) |
| `companies.settings.meeting_assistant` | `{enabled: bool, questions: string[]}` no JSON existente. Desligado por padrão, com o roteiro padrão ao ligar. |

### RLS

- `meetings`, `meeting_notes` e `meeting_suggestions` seguem a visibilidade do registro vinculado: quem pode ver o negócio, lead, pessoa ou organização vê a reunião. Reunião sem vínculo: só o dono e o admin geral.
- `meeting_transcripts`: a mesma regra, lida por uma função `security definer` que confere o acesso ao registro.
- Escrita: só o service role (cron) e as server actions de confirmar, editar, descartar e vincular, que conferem a permissão de edição no registro.

## Fluxos

### Capturar (cron a cada 10 min)

1. Para cada `email_accounts` ativa com os escopos do Meet, e com o assistente ligado na empresa: `conferenceRecords.list` com `end_time` maior que o último cursor da conta (`meeting_cursor` em `email_accounts`).
2. Para cada reunião encerrada:
   - se o `conference_record` já existe em `meetings`, pula;
   - senão, cria em `waiting_transcript`.
3. Busca o evento da Agenda pelo código da reunião (o `conferenceData` do evento). Ele dá o título e os convidados. Sem evento (reunião instantânea), usa os participantes do `conferenceRecords.participants`.
4. Sem convidado externo: `ignored`.
5. Transcrição: se o estado é `FILE_GENERATED`, lê as `entries` e grava em `meeting_transcripts`. Senão, tenta de novo na próxima rodada. Se não houver transcrição 2 h depois do fim, marca `failed` com "reunião sem transcrição".
6. Lease por conta (`sync_lock_until`), como no Gmail, para duas rodadas não processarem a mesma conta.

### Vincular (função pura)

Entrada: e-mails dos convidados externos, a empresa da caixa e o horário. Saída: um registro, ou nenhum.

1. Pessoas da empresa com algum desses e-mails.
2. Negócio aberto da pessoa ou da organização dela. Se houver vários, ganha o que tem uma reunião agendada no Pipedrive mais perto do horário (até ±1 dia). Se nenhum tiver, ganha o de atividade mais recente.
3. Sem negócio: lead aberto da pessoa.
4. Sem lead: a própria pessoa.
5. Nenhuma pessoa encontrada, ou empate sem critério: `unlinked`.

A reunião agendada encontrada vira `anchor_activity_id`.

### Gerar as notas

- O Claude recebe:
  - a transcrição, cortada no limite de contexto;
  - o roteiro da empresa;
  - título, data e participantes;
  - o contexto do registro: etapa, valor, Setup/MRR e as últimas 3 anotações.
- Devolve um JSON com:
  - `summary`, `pains[]`, `objections[]`;
  - `qualification[]`, uma resposta por pergunta do roteiro, com "Não mencionado" quando não houver;
  - `next_steps[]`;
  - `suggestions`: o resultado da reunião, um dos resultados de reunião da empresa no Pipedrive; a próxima atividade, com tipo, assunto e data; e a etapa sugerida, só quando a conversa deixa claro o avanço.
- A resposta é validada com zod. Inválida conta como tentativa.
- Até 3 tentativas. Depois, `failed`, com "Tentar de novo" na tela.

### Gravar

- **Anotação, direto:**
  - HTML com Resumo, Dores, Objeções, Qualificação e Próximos passos;
  - no rodapé, "Gerada pelo assistente a partir da reunião de dd/mm hh:mm";
  - vai ao Pipedrive em nome do vendedor, ligada ao negócio, lead ou pessoa;
  - grava `pipedrive_note_id`, e o status vira `done`.
- **Sugestões:** viram `meeting_suggestions` em `pending`. Ao confirmar:
  - resultado: conclui a reunião âncora no Pipedrive (`done` e `outcome`), ou cria uma reunião concluída se não houver âncora;
  - próxima atividade: cria a atividade no Pipedrive;
  - etapa: move o negócio.

  A sincronização das 9h traz tudo para o CRM.
- **Reunião sem vínculo:** as notas ficam guardadas, e nada é gravado no Pipedrive. O assistente **nunca cria** pessoa, organização, lead ou negócio. O vendedor tem duas saídas:
  - **Vincular:** escolhe um registro que já existe, e a gravação acima roda na hora. Se for um prospect novo, ele cria o card no Pipedrive (validação humana) e vincula depois da sincronização.
  - **Descartar:** a reunião não é comercial (fornecedor, parceiro, entrevista). Ela vira `ignored`, e a transcrição e as notas são apagadas.
- Sem decisão em 7 dias, a reunião sem vínculo é descartada sozinha, com a transcrição apagada.

### Ver no CRM

- **Card do registro:** um bloco "Reunião (Meet)" no histórico, com resumo, qualificação, próximos passos, as sugestões com Confirmar, Editar e Descartar, e "Ver transcrição", que expande.
- **Página `/[empresa]/reunioes`:**
  - abas Pendentes (sugestões sem decisão), Sem vínculo, Com erro e Todas;
  - o vendedor vê as dele; quem tem visibilidade de equipe ou da empresa vê as do alcance, com destaque para as pendentes há mais de 24 h.
- **Até a sincronização das 9h:** a anotação vive no Pipedrive e no `meeting_notes`. O card mostra a reunião pelo `meeting_notes`, então ela aparece no CRM na hora.
- **Sem duplicar:** quando a sincronização traz a anotação do Pipedrive, o histórico esconde a anotação importada cujo id do Pipedrive é o `pipedrive_note_id` de uma reunião, já que o bloco da reunião mostra o mesmo conteúdo.

### Configurações

- Em Configurações → Assistente de reuniões, por empresa:
  - liga e desliga;
  - edita o roteiro (lista de perguntas, com reordenar, adicionar e remover).
- Na conexão Google: aviso "Reconecte para ativar o assistente de reuniões" quando faltar algum escopo.

## Variáveis de ambiente

- `ANTHROPIC_API_KEY` (nova).
- `MEETING_SINK` (opcional, padrão `pipedrive`).
- `PIPEDRIVE_API_TOKEN`, que já existe e passa a ser usada também pela Vercel.

## Configuração (passo a passo para o usuário)

1. **Admin Console → Apps → Google Workspace → Google Meet → Gravação e transcrição:** ligar a transcrição e deixá-la ativada por padrão nas reuniões.
2. **Google Cloud do app Oxyn CRM Web:** ativar Google Meet REST API e Google Calendar API, e incluir os dois escopos novos na tela de consentimento.
3. **Vercel:** cadastrar `ANTHROPIC_API_KEY` e `PIPEDRIVE_API_TOKEN`.
4. **Cada vendedor:** reconectar o Google em Configurações → E-mail.
5. **Admin geral:** ligar o assistente nas empresas desejadas.

## Erros

| Situação | Comportamento |
|---|---|
| Escopo do Meet ausente | A conta é pulada, e a tela de conexão pede para reconectar. |
| Transcrição ainda não gerada | Tenta de novo nas próximas rodadas, até 2 h depois do fim. |
| Reunião sem transcrição | `failed`, "reunião sem transcrição" (por exemplo, a transcrição não foi ligada). |
| Claude falha ou devolve JSON inválido | Até 3 tentativas. Depois, `failed` com "Tentar de novo". |
| Pipedrive recusa ou fica fora do ar | A anotação fica em `meeting_notes` sem `pipedrive_note_id`, e a rodada seguinte tenta de novo (até 3). Uma sugestão que falhar fica `failed` com a mensagem. |
| Registro vinculado foi para a lixeira | A gravação falha com "registro excluído", e a reunião volta para Sem vínculo. |
| Mesma reunião vista por dois vendedores | O `conference_record` único garante um processamento só. Quem trouxe primeiro vira o dono, a menos que o organizador do evento seja outro usuário do CRM. Nesse caso, o organizador é o dono. |

## Privacidade

- A página de Privacidade ganha:
  - os escopos do Meet e da Agenda;
  - a Anthropic como fornecedora de processamento das transcrições, sem treinamento com os dados (conforme os termos comerciais da API);
  - a guarda da transcrição no CRM.
- A transcrição só é lida para reuniões com convidado externo e com o assistente ligado na empresa.

## Testes

- **Vitest:**
  - casador de vínculo: externos e internos, negócio contra lead contra pessoa, âncora, empate;
  - montagem do pedido ao Claude e validação da resposta (válida, inválida, roteiro vazio);
  - HTML da anotação;
  - `pipedriveSink`, com `fetch` simulado: autoria, vínculo, conclusão com resultado, nova atividade e erro;
  - cliente do Meet e da Agenda, com `fetch` simulado;
  - a regra do cron: idempotência, espera da transcrição, 2 h, tentativas.
- **pgTAP** (quando houver banco de testes): RLS de `meetings` e `meeting_transcripts` pela visibilidade do registro.
- **Teste real:** uma reunião do usuário com um contato de teste, antes de ligar o assistente para o time.

## Fora do escopo (v1)

- Reuniões fora do Google Meet (Zoom, Teams, presencial).
- Avisos em tempo real (Workspace Events API).
- Atualização automática de campos personalizados do negócio.
- Rascunho do e-mail de follow-up.
- Análise entre reuniões (objeções mais comuns, padrões de ganho).
- Criar pessoas, organizações, leads ou negócios a partir dos convidados (decisão do usuário: nada é criado sem validação).

## Riscos a confirmar no começo da implementação

- **Acesso à transcrição pela API:** confirmar com uma reunião real que a conta do organizador lê `transcripts.entries` com `meetings.space.readonly`, e que um participante que não é o organizador não lê. Se só o organizador lê, reuniões organizadas por quem não conectou o Google ficam de fora; registrar isso na tela.
- **Resultados de reunião no Pipedrive:** os ids de `outcome` das atividades vêm do Pipedrive (`activityOutcomeNames` da importação). Confirmar que `PUT /v1/activities/{id}` aceita `outcome` com o token atual.
- **Verificação do Google:** incluir escopos novos pode exigir nova verificação do app. Para os domínios que marcaram o app como Confiável, o uso interno não deve travar.
