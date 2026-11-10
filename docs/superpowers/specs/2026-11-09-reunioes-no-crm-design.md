# Assistente de reuniões gravando no CRM

Data: 2026-11-09. Parte 3 de 3 da preparação para desligar o Pipedrive (as outras partes: `2026-11-09-importar-emails-arquivos-pipedrive-design.md` e `2026-11-09-agenda-google-design.md`). Complementa a spec `2026-11-05-assistente-reunioes-design.md`.

## Objetivo

Hoje o assistente grava a anotação, o resultado da reunião, a próxima atividade e a etapa no Pipedrive (`pipedriveSink`), porque o modo espelho apaga o que for gravado direto no CRM. No desligamento, ele passa a gravar no CRM. A interface `MeetingSink` foi criada para essa troca, mas só tem a implementação do Pipedrive.

**Sucesso:** com `MEETING_SINK=crm`, a mesma reunião produz a anotação no card do CRM e as sugestões confirmadas mudam atividades e negócios do CRM, com a autoria certa no histórico. Nada vai para o Pipedrive.

## Decisões

| Tema | Decisão |
|---|---|
| Troca | Variável `MEETING_SINK` (`pipedrive` ou `crm`; o padrão continua `pipedrive`). Ela é trocada na virada, depois de desligar o modo espelho. |
| Trava de segurança | Com `MEETING_SINK=crm` e o modo espelho ainda ativo (o último job de importação é espelho e terminou há menos de 48 h), o assistente não grava. A reunião fica em `processing`, com o erro "modo espelho ativo: o Pipedrive apagaria o que fosse gravado no CRM". |
| Ids | O alvo passa a ser o registro do CRM (entidade e uuid). A implementação do Pipedrive continua resolvendo os ids do Pipedrive por dentro, então `run.ts` e `actions.ts` deixam de depender de `pipedriveIdOf`. |
| Organização | No CRM, a reunião vinculada a uma organização também grava (no Pipedrive não gravava). |
| Nomes para o Claude | No modo CRM, os resultados de reunião, os tipos de atividade e as etapas vêm dos cadastros do CRM: `activity_outcomes` de reunião, `activity_types` ativos e etapas do funil. No modo Pipedrive continuam vindo do Pipedrive. |
| Autoria | A anotação automática é gravada em nome do dono da reunião (`created_by`). No histórico, a autoria aparece como "Assistente de reuniões". As sugestões confirmadas no CRM rodam com o cliente do usuário que confirmou, com RLS e gatilhos normais, então o histórico registra quem confirmou. |
| Anotação duplicada no card | O bloco da reunião já mostra as notas, então a anotação gravada pelo assistente fica escondida do histórico (pelo id guardado), como hoje acontece com a cópia importada do Pipedrive. |

## Interface nova

```ts
type CrmTarget = { companyId: string; entity: "deals" | "leads" | "persons" | "organizations"; recordId: string };

interface MeetingSink {
  writeNote(t: CrmTarget, html: string, ownerId: string): Promise<{ noteRef: string }>;
  completeMeeting(t: CrmTarget, a: { anchorActivityId: string | null; outcome: string; subject: string; startedAt: string; ownerId: string }): Promise<void>;
  createActivity(t: CrmTarget, a: { type: string; subject: string; dueDate: string; dueTime: string | null; ownerId: string }): Promise<void>;
  moveStage(t: CrmTarget, stage: string): Promise<void>;
}
```

- `pipedriveSink` passa a receber esse alvo e converte por dentro: `external_ids` para o id do Pipedrive, o mapa de usuários, o resultado pelo nome e a etapa pelo nome dentro do funil do negócio. A conversão que hoje está em `run.ts` e `actions.ts` vai para dentro dele. O comportamento não muda.
- `crmSink`:
  - **`writeNote`:** insere em `notes` (`created_by` = dono). `meeting_notes` ganha `crm_note_id`, e o `noteRef` vai para o campo da implementação usada (`pipedrive_note_id` ou `crm_note_id`).
  - **`completeMeeting`:**
    - com âncora: conclui a atividade do CRM com o resultado da reunião, usando a função de concluir já existente (`complete_activity`);
    - sem âncora: cria a atividade de reunião (tipo Reunião, canal da âncora ou Videochamada) já concluída.
  - **`createActivity`:** cria a atividade com o tipo pelo nome, o canal da reunião (o da âncora, senão Videochamada, senão o primeiro canal ativo) e o vínculo do registro.
  - **`moveStage`:** muda a etapa do negócio pelo nome, dentro do funil dele. Campos obrigatórios da etapa que faltarem fazem a sugestão ficar `failed` com "Faltam campos para esta etapa: …". O vendedor completa no card e tenta de novo.
- **Quem escreve:**
  - O cron (anotação) roda sem usuário logado. As escritas dele passam por funções `security definer` só para o service role: `meet_add_note`, `meet_complete_activity`, `meet_create_activity`. Elas recebem o autor e gravam o histórico em nome dele.
  - As confirmações feitas no CRM usam o cliente do usuário e as funções existentes.

## Erros

| Situação | Comportamento |
|---|---|
| Modo espelho ativo com `MEETING_SINK=crm` | Não grava; a reunião fica em `processing` com o aviso, sem gastar tentativas. Volta sozinha quando o espelho for desligado. |
| Registro na lixeira | Mesmo comportamento de hoje: "registro excluído" e a reunião volta para Sem vínculo. |
| Etapa com campos obrigatórios faltando | A sugestão fica `failed` com a lista de campos. |
| Tipo, resultado ou etapa que não existe mais no CRM | A sugestão fica `failed` com a mensagem; o vendedor pode editar e confirmar de novo. |

## Testes

- **`pipedriveSink` com o alvo novo:** as mesmas chamadas ao Pipedrive de hoje.
- **`crmSink` com banco falso:**
  - anotação com `crm_note_id`;
  - conclusão com âncora e sem âncora;
  - próxima atividade com canal herdado;
  - etapa com campos obrigatórios faltando.
- **Trava do modo espelho:** espelho recente bloqueia; espelho antigo ou desligado libera.
- **Nomes para o Claude no modo CRM:** vêm dos cadastros do CRM.
- **Histórico do card:** a anotação do assistente fica escondida pelo `crm_note_id`.
