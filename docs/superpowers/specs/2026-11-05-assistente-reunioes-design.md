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
| Plano do Workspace | Business Standard (conferido pelo usuário). Tem transcrição do Meet, mas ela não começa sozinha: alguém precisa iniciá-la em cada reunião. Começar sozinha exige upgrade, que não compensa (usuário, 2026-11-09). |
| Sem transcrição | **Anotações do Gemini** (2026-11-09). O Business Standard tem "Anotações com o Gemini", que pode ficar ligado no evento da Agenda. Quando a reunião não tem transcrição, o assistente usa essas anotações. |

## Decisões técnicas (minhas, registradas)

- **Fonte:** API REST do Google Meet (`conferenceRecords`, `transcripts`, `transcripts.entries`, `smartNotes`) e API da Agenda (`events.list`), consultadas por um cron. O texto das anotações do Gemini vem do Google Doc indicado em `smartNotes.docsDestination.document`, exportado em texto pelo Drive (`files.export`). Não há bot entrando na reunião. Avisos em tempo real (Workspace Events API com Pub/Sub) ficam para uma versão futura.
- **Mesma conexão Google do Gmail.** A conta conectada em `email_accounts` ganha os escopos `https://www.googleapis.com/auth/meetings.space.readonly`, `https://www.googleapis.com/auth/calendar.events.readonly` e `https://www.googleapis.com/auth/drive.meet.readonly` (só arquivos criados pelo Meet; escopo restrito, que funciona nos domínios que marcaram o app como confiável). Quem já está conectado precisa reconectar uma vez. A reunião herda a empresa da caixa, já que é uma empresa por caixa.
- **Cron em `/api/cron/meet`** a cada 10 minutos, com `maxDuration` 300. Entra em `SELF_AUTH` no proxy e é conferido em produção com curl (401, não 307).
- **Claude pela API** com o SDK oficial `@anthropic-ai/sdk`: `messages.parse` com `zodOutputFormat`, que é saída estruturada validada pelo próprio SDK. O modelo é `claude-opus-5-5` com `effort: "medium"`, e custa cerca de US$ 0,10 por reunião de 1 hora. Há fallback no servidor em caso de recusa (`fallbacks: "default"`). A chave fica em `ANTHROPIC_API_KEY`.
- **Escrita no Pipedrive** com `PIPEDRIVE_API_TOKEN`, a mesma chave da sincronização. A autoria vai pelo `user_id` do Pipedrive do vendedor, obtido do mapa de usuários da última importação (`mappings.users`, ao contrário). Usa `POST /v1/notes`, `PUT /v1/activities/{id}`, `POST /v1/activities` e `PUT /v1/deals/{id}`.
- **Destino trocável:** a gravação passa por uma interface `MeetingSink` com duas implementações, `pipedriveSink` (agora) e `crmSink` (depois do desligamento). A escolha fica em `MEETING_SINK=pipedrive|crm`, com padrão `pipedrive`.
- **Tabelas próprias** (`meetings` e afins). A limpeza do modo espelho não mexe nelas, porque só cuida de anotações, atividades, negócios, leads, pessoas e organizações.
- **Domínios internos:** os domínios dos e-mails dos usuários do CRM (`profiles.email`). Um convidado é externo se o domínio dele não está nessa lista.

## Modelo de dados

| Tabela | Campos |
|---|---|
| `meetings` | id, company_id, account_id → email_accounts (quem trouxe a reunião), owner_id → profiles (o vendedor), conference_record text (único global: chave de idempotência), calendar_event_id, title, started_at, ended_at, attendees jsonb (`{email, name, internal}`), status (`waiting_transcript`, `processing`, `unlinked`, `done`, `failed`, `ignored`), attempts int, last_error, entity (`deals`, `leads`, `persons`, `organizations`, nulo enquanto sem vínculo), record_id, anchor_activity_id (reunião agendada encontrada), created_at, updated_at |
| `meeting_transcripts` | meeting_id (pk, cascade), entries jsonb (`{speaker, text, start}`), text (transcrição corrida, até 1 MB), source (`transcript` ou `gemini_notes`; nas anotações do Gemini, `entries` fica vazio) |
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
5. Texto da reunião, com a transcrição como fonte preferida:
   - transcrição `FILE_GENERATED` e com fala: lê as `entries` e grava em `meeting_transcripts` (`source = transcript`);
   - alguma transcrição ainda gerando: tenta de novo na próxima rodada, até o prazo;
   - sem transcrição pronta (ou pronta e vazia): usa as anotações do Gemini. Com alguma sessão ainda gerando, espera até o prazo. Os documentos `FILE_GENERATED` (sem repetir) são exportados e juntados; um documento que não abre não descarta os outros. Grava com `source = gemini_notes`;
   - nada disso 2 h depois do fim: `failed` com "reunião sem transcrição nem anotações do Gemini".
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
  - a transcrição, cortada no limite de contexto (ou as anotações do Gemini, numa tag própria `<notas_gemini>` e com o aviso de que são um resumo, não a conversa inteira);
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
- **Menu lateral:** item "Reuniões" com um contador do que espera decisão do usuário (sem vínculo e sugestões pendentes dele).
- **Sino de notificações:** um aviso quando uma reunião do usuário cai em Sem vínculo, porque ela é descartada sozinha em 7 dias. Para isso, `notifications.kind` ganha `meeting_unlinked` e a coluna `meeting_id` (cascade).
- **Card que foi para a lixeira:** se o registro vinculado for para a lixeira (por exemplo, porque o modo espelho viu que ele foi apagado no Pipedrive), a reunião guarda o vínculo, mas aparece em Sem vínculo enquanto o registro estiver na lixeira (estado calculado, não gravado). Se o registro for restaurado, ela volta ao card sozinha.
- **Sem duplicar:** quando a sincronização traz a anotação do Pipedrive, o histórico esconde a anotação importada cujo id do Pipedrive é o `pipedrive_note_id` de uma reunião, já que o bloco da reunião mostra o mesmo conteúdo.

### Tela inicial (`/[empresa]/inicio`)

Pedido do usuário em 2026-11-05: aproveitar a tela inicial, que hoje está quase vazia. Tudo é **do usuário logado**, na empresa (ou empresas) do escopo, no dia de hoje em horário de São Paulo.

- **Indicador do dia:** "Realizadas X de Y (Z%)".
  - **Y (marcadas):** atividades de reunião (`activity_types.is_meeting`) do usuário com `due_at` hoje e não excluídas.
  - **X (realizadas):** dessas, as que tiveram reunião do Meet ligada (`meetings.anchor_activity_id`) ou foram concluídas com `meeting_outcome = 'held'`.
  - Sem reuniões marcadas, aparece "Nenhuma reunião marcada hoje".
- **Reuniões de hoje:** lista das marcadas, por horário, com:
  - assunto e card vinculado (com link);
  - situação: **Realizada**, **A fazer** (horário ainda não passou) ou **Não realizada** (passou mais de 1 h do horário sem Meet e sem conclusão).
- **Realizadas hoje (Meet):** reuniões da tabela `meetings` do usuário encerradas hoje, com título, card e as duas primeiras linhas do resumo. Leva ao bloco da reunião no card.
- **Sem vínculo:** as reuniões sem vínculo do usuário (inclusive as de card na lixeira), com Vincular e Descartar, iguais aos da página Reuniões. O bloco só aparece quando há alguma.



- Em Configurações → Assistente de reuniões, por empresa:
  - liga e desliga;
  - edita o roteiro (lista de perguntas, com reordenar, adicionar e remover).
- Na conexão Google: aviso "Reconecte para ativar o assistente de reuniões" quando faltar algum escopo.

## Variáveis de ambiente

- `ANTHROPIC_API_KEY` (nova).
- `MEETING_SINK` (opcional, padrão `pipedrive`).
- `PIPEDRIVE_API_TOKEN`, que já existe e passa a ser usada também pela Vercel.

## Configuração (passo a passo para o usuário)

1. **Admin Console:** no Business Standard a transcrição já vem ligada e não há o que configurar. Os vendedores ligam "Fazer anotações com o Gemini" ao criar o evento na Agenda (ou iniciam a transcrição na reunião).
2. **Google Cloud do app Oxyn CRM Web:** ativar Google Meet REST API, Google Calendar API e Google Drive API, e incluir os três escopos novos na tela de consentimento.
3. **Banco:** aplicar a migration `20261109000001_meeting_transcript_source.sql` antes de publicar o código que grava `source`.
4. **Vercel:** cadastrar `ANTHROPIC_API_KEY` e `PIPEDRIVE_API_TOKEN`.
5. **Cada vendedor:** reconectar o Google em Configurações → E-mail.
6. **Admin geral:** ligar o assistente nas empresas desejadas.

## Erros

| Situação | Comportamento |
|---|---|
| Escopo do Meet ausente | A conta é pulada, e a tela de conexão pede para reconectar. |
| Transcrição ainda não gerada | Tenta de novo nas próximas rodadas, até 2 h depois do fim. |
| Reunião sem transcrição | Usa as anotações do Gemini. Sem nenhum dos dois: `failed`, "reunião sem transcrição nem anotações do Gemini" (por exemplo, ninguém ligou a transcrição nem o Gemini). |
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
